import { Command } from "commander";
import {
  requireCredentials,
  resolveAuthCenterUrl,
  CliAuthError,
  CliUsageError,
  AuthCenterError,
  classifyAuthCenterFailure,
  classifyCliAuthFailure,
  parseLimit,
  uploaderSearch,
  uploaderFetch,
  SERVER_HINT,
} from "../core/index.js";
import { printError, printInfo, printJson } from "../output.js";

interface BaseOpts {
  json?: boolean;
  profile?: string;
}

// `reason` carries auth-center's own slug straight through. Five distinct
// server-side conditions collapse into `code: "server"` (spec 18 § 6.3), so
// without this a monitor cannot tell "the document service's credential is
// dead — page someone" from "it blipped for 30 seconds" — the two look
// identical down to the character.
type UploaderResult =
  | { ok: true; code: string; [key: string]: unknown }
  | { ok: false; error: string; code: string; hint: string; reason?: string };

const PROFILE_OPTION = [
  "--profile <name>",
  "use a named credential profile instead of the default (see BOBBY_CLI_PROFILES_DIR)",
] as const;

const DOCUMENT_TYPES = [
  "reservation_list",
  "rate_sheet",
  "occupancy_report",
  "folio",
  "pos_summary",
  "line_chat_history",
  "other",
];
const SOURCE_SYSTEMS = ["hotelline", "hoteltime", "pos_sql"];

const MAX_LIMIT = 50;
const DEFAULT_MAX_CHARS = 6000;
const DESCRIPTION_LIMIT = 200;

function usageFailure(message: string): UploaderResult {
  return { ok: false, error: message, code: "usage", hint: message };
}

function emit(result: UploaderResult, json?: boolean, humanText?: string): void {
  if (json) {
    printJson(result);
    if (!result.ok) process.exitCode = 1;
    return;
  }
  if (result.ok) {
    if (humanText) console.log(humanText);
  } else {
    printError(result.error);
    printInfo(result.hint);
    process.exitCode = 1;
  }
}

function toFailure(err: unknown): UploaderResult {
  if (err instanceof CliAuthError) {
    const failure = classifyCliAuthFailure(err);
    return { ok: false, error: err.message, code: failure.code, hint: failure.hint };
  }
  if (err instanceof CliUsageError) return usageFailure(err.message);
  if (err instanceof AuthCenterError) {
    const failure = classifyAuthCenterFailure(err, "uploader");
    return { ok: false, error: err.message, code: failure.code, hint: failure.hint, reason: err.slug };
  }
  return { ok: false, error: (err as Error).message, code: "server", hint: SERVER_HINT };
}

function requireEnum(value: string | undefined, allowed: string[], flag: string): void {
  if (value === undefined) return;
  if (!allowed.includes(value)) {
    throw new CliUsageError(`${flag} must be one of: ${allowed.join(", ")} — got "${value}".`);
  }
}

function requireDateFormat(value: string | undefined, pattern: RegExp, flag: string, shape: string): void {
  if (value === undefined) return;
  if (!pattern.test(value)) {
    throw new CliUsageError(`${flag} must be ${shape} — got "${value}".`);
  }
}

interface SearchOpts extends BaseOpts {
  documentType?: string;
  sourceSystem?: string;
  fileType?: string;
  eventLabel?: string;
  day?: string;
  month?: string;
  dateFrom?: string;
  dateTo?: string;
  limit: string;
}

// Everything here runs before any network call, and every failure is `usage`
// (spec 17 § 3.1). Two rules are less obvious than they look:
//   - the date filters are mutually exclusive because the server applies its
//     own precedence silently, and silently-ignored input is the one class of
//     bug an agent cannot see;
//   - --date-from/--date-to only mean something as a pair.
function validateSearch(query: string | undefined, opts: SearchOpts): { params: Record<string, string | undefined>; limit: number } {
  requireEnum(opts.documentType, DOCUMENT_TYPES, "--document-type");
  requireEnum(opts.sourceSystem, SOURCE_SYSTEMS, "--source-system");
  requireDateFormat(opts.day, /^\d{4}-\d{2}-\d{2}$/, "--day", "YYYY-MM-DD");
  requireDateFormat(opts.month, /^\d{4}-\d{2}$/, "--month", "YYYY-MM");
  requireDateFormat(opts.dateFrom, /^\d{4}-\d{2}-\d{2}$/, "--date-from", "YYYY-MM-DD");
  requireDateFormat(opts.dateTo, /^\d{4}-\d{2}-\d{2}$/, "--date-to", "YYYY-MM-DD");

  if (Boolean(opts.dateFrom) !== Boolean(opts.dateTo)) {
    throw new CliUsageError("--date-from and --date-to must be given together.");
  }

  const dateFilters = [opts.day, opts.month, opts.dateFrom].filter(Boolean).length;
  if (dateFilters > 1) {
    throw new CliUsageError("Use only one of --day, --month, or --date-from/--date-to.");
  }

  const limit = parseLimit(opts.limit, "-n/--limit", MAX_LIMIT);

  // `.pdf` and `pdf` are the same thing to a person typing it.
  const fileType = opts.fileType?.replace(/^\./, "");

  const params: Record<string, string | undefined> = {
    query,
    document_type: opts.documentType,
    source_system: opts.sourceSystem,
    file_type: fileType,
    event_label: opts.eventLabel,
    day: opts.day,
    month: opts.month,
    date_from: opts.dateFrom,
    date_to: opts.dateTo,
    limit: String(limit),
  };

  if (!query && !hasFilter(params)) {
    throw new CliUsageError("Give a query or at least one filter.");
  }

  return { params, limit };
}

function hasFilter(params: Record<string, string | undefined>): boolean {
  return ["document_type", "source_system", "file_type", "event_label", "day", "month", "date_from", "date_to"]
    .some((key) => Boolean(params[key]));
}

function firstEventDate(result: Record<string, unknown>): string | undefined {
  const events = result.time_events;
  if (!Array.isArray(events)) return undefined;
  const starts = events
    .map((event) => (event && typeof event === "object" ? (event as Record<string, unknown>).start : undefined))
    .filter((start): start is string => typeof start === "string" && start.length > 0)
    .sort();
  // "2024-05-22T17:00:00Z" is noise on a line meant for hotel staff.
  return starts[0]?.slice(0, 10);
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

// The deliverable of the demo is a list of file names with descriptions, so the
// CLI composes that line — not the model. `score` is deliberately absent: it is
// an RRF rank, meaningless to hotel staff and actively misleading if read as a
// percentage.
function composeText(
  results: Record<string, unknown>[],
  mode: "hybrid" | "filter_only",
  truncated: boolean,
  limit: number
): string {
  if (results.length === 0) return "No documents matched.";

  const lines = results.map((result, index) => {
    const name = asString(result.original_name) ?? asString(result.title) ?? asString(result.id) ?? "(unnamed)";
    const description = (asString(result.description) ?? asString(result.title) ?? "(no description)").slice(0, DESCRIPTION_LIMIT);
    const meta = [asString(result.document_type), asString(result.source_system), firstEventDate(result)].filter(Boolean);
    const suffix = meta.length > 0 ? ` (${meta.join(" · ")})` : "";
    const line = `${index + 1}. ${name} — ${description}${suffix}`;
    // Flagged, never hidden: the file exists, and "does it exist?" is a
    // question search still answers.
    return asString(result.md_file_url) ? line : `${line}\n   [markdown not ready]`;
  });

  const notes: string[] = [];
  if (mode === "filter_only") notes.push("(ordered by date, newest first — not by relevance)");
  if (truncated) notes.push(`(showing the first ${limit} of possibly more)`);

  return [...lines, ...notes].join("\n");
}

// Cuts at the last complete line: occupancy and reservation exports are
// markdown tables, and half a row is worse than one row fewer.
//
// `serverTruncated` is not a detail that can be skipped. auth-center caps the
// payload at max_chars before this code sees it, so the text arrives already
// short enough — and cutting only on length would return the server's raw cut,
// mid-row, exactly what this function exists to prevent.
function truncateAtLineBoundary(
  markdown: string,
  maxChars: number,
  serverTruncated: boolean
): { text: string; truncated: boolean } {
  if (markdown.length <= maxChars && !serverTruncated) return { text: markdown, truncated: false };
  const cut = markdown.slice(0, maxChars);
  const lastNewline = cut.lastIndexOf("\n");
  // No newline at all means one very long line: a raw cut beats returning
  // nothing.
  return { text: lastNewline > 0 ? cut.slice(0, lastNewline) : cut, truncated: true };
}

export function registerUploaderCommand(program: Command): void {
  const uploader = program
    .command("uploader")
    .description("Search and read indexed documents (through auth-center)");

  uploader
    .command("search [query]")
    .description("Search indexed documents by text and/or filters")
    .option("--document-type <type>", `one of: ${DOCUMENT_TYPES.join(", ")}`)
    .option("--source-system <system>", `one of: ${SOURCE_SYSTEMS.join(", ")}`)
    .option("--file-type <ext>", "file extension, e.g. pdf or xlsx")
    .option("--event-label <text>", "event label recorded on the document")
    .option("--day <YYYY-MM-DD>", "documents covering this day")
    .option("--month <YYYY-MM>", "documents covering this month")
    .option("--date-from <YYYY-MM-DD>", "start of a date range (use with --date-to)")
    .option("--date-to <YYYY-MM-DD>", "end of a date range (use with --date-from)")
    .option("-n, --limit <n>", `number of results (max ${MAX_LIMIT})`, "10")
    .option(...PROFILE_OPTION)
    .option("--json", "machine-readable output")
    .action(async (query: string | undefined, opts: SearchOpts) => {
      let text = "";
      let result: UploaderResult;
      try {
        const { params, limit } = validateSearch(query, opts);
        const creds = requireCredentials(opts.profile);
        const authCenterUrl = resolveAuthCenterUrl(creds.authCenterUrl);

        let response = await uploaderSearch(authCenterUrl, creds.apiToken, params);
        let mode: "hybrid" | "filter_only" = query ? "hybrid" : "filter_only";
        let retriedWithoutQuery = false;

        // Filter-first retry, the pattern the uploader's own reference
        // implementation proved: a query narrows a filtered search to nothing
        // more often than it helps.
        if (query && hasFilter(params) && response.results.length === 0) {
          response = await uploaderSearch(authCenterUrl, creds.apiToken, { ...params, query: undefined });
          retriedWithoutQuery = true;
          mode = "filter_only";
        }

        const results = response.results ?? [];
        // Top-K only — there is no paging, so "count === limit" is all anyone
        // can say about whether more exist.
        const truncated = results.length === limit;
        text = composeText(results, mode, truncated, limit);
        result = {
          ok: true,
          code: "results",
          count: results.length,
          mode,
          retriedWithoutQuery,
          truncated,
          results,
          text,
        };
      } catch (err) {
        result = toFailure(err);
      }
      emit(result, opts.json, text);
    });

  uploader
    .command("fetch <id>")
    .description("Read one document's markdown by record id")
    .option("--max-chars <n>", "maximum characters of markdown to return", String(DEFAULT_MAX_CHARS))
    .option(...PROFILE_OPTION)
    .option("--json", "machine-readable output")
    .action(async (id: string, opts: BaseOpts & { maxChars: string }) => {
      let human = "";
      let result: UploaderResult;
      try {
        // auth-center takes a record id and nothing else. A URL argument was
        // removed with spec 18: this value is routinely written by a model,
        // and a model reading a hostile document must not get to choose what
        // the server fetches.
        if (/^https?:\/\//i.test(id)) {
          throw new CliUsageError("Pass the record id (pb_record_id) from a search result, not a URL.");
        }
        const maxChars = parseLimit(opts.maxChars, "--max-chars");
        const creds = requireCredentials(opts.profile);
        const authCenterUrl = resolveAuthCenterUrl(creds.authCenterUrl);

        const response = await uploaderFetch(authCenterUrl, creds.apiToken, id, maxChars);

        if (response.mdReady === false || typeof response.markdown !== "string") {
          // Exit 0 with `not_found`: the question was answered, and the answer
          // is "there is nothing to read yet". Same semantics as `memory
          // forget` on an id that is already gone.
          human = `No markdown available for ${id} (not indexed yet).`;
          result = { ok: true, code: "not_found", id, text: human };
        } else {
          const record = response.record ?? {};
          const { text, truncated } = truncateAtLineBoundary(
            response.markdown,
            maxChars,
            response.truncated === true
          );
          human = text;
          result = {
            ok: true,
            code: "fetched",
            id,
            originalName: asString(record.original_name) ?? null,
            title: asString(record.title) ?? null,
            chars: text.length,
            truncated,
            markdown: text,
          };
        }
      } catch (err) {
        result = toFailure(err);
        // A 404 means the id does not exist — an answered question, not a
        // failure, so it must not send an agent into a retry loop.
        if (result.ok === false && result.reason === "not_found") {
          human = `No document with id ${id}.`;
          result = { ok: true, code: "not_found", id, text: human };
        }
      }
      emit(result, opts.json, human);
    });
}
