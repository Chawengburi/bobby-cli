import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Command } from "commander";

import { registerUploaderCommand } from "../src/commands/uploader.js";

// Drives the real commander program, because every rule spec 18 § 6.3 defines
// lives in the mapping between an auth-center response and the envelope — not
// in any single function. A test of the client alone would pass with the whole
// error table wired backwards.

const realFetch = globalThis.fetch;
const realLog = console.log;
const realError = console.error;

afterEach(() => {
  globalThis.fetch = realFetch;
  console.log = realLog;
  console.error = realError;
  process.exitCode = 0;
});

interface Call {
  url: string;
  authorization: string | null;
}

function makeProfile(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "bobby-cli-uploader-"));
  writeFileSync(
    join(dir, "owner.json"),
    JSON.stringify({
      authCenterUrl: "https://auth-center.test",
      sessionMemoryUrl: "https://sm.test/mcp",
      email: "owner@example.com",
      tenantId: "t1",
      apiToken: "sm_live_testtoken",
      apiTokenId: "tok_1",
      apiTokenLabel: "test",
      scopes: [],
      createdAt: new Date().toISOString(),
      expiresAt: null,
    })
  );
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

async function runUploader(
  argv: string[],
  options: { responses?: Response[]; profilesDir?: string; failNetwork?: boolean } = {}
): Promise<{ envelope: Record<string, unknown>; exitCode: number; calls: Call[] }> {
  const calls: Call[] = [];
  let index = 0;
  globalThis.fetch = (async (input: string | URL, init: RequestInit = {}) => {
    const url = typeof input === "string" ? input : input.toString();
    calls.push({ url, authorization: new Headers(init.headers ?? {}).get("authorization") });
    if (options.failNetwork) {
      const err = new TypeError("fetch failed");
      (err as unknown as { cause: { code: string } }).cause = { code: "ECONNREFUSED" };
      throw err;
    }
    const responses = options.responses ?? [];
    const res = responses[index] ?? responses[responses.length - 1];
    index += 1;
    if (!res) throw new Error("test made an unexpected network call");
    return res;
  }) as unknown as typeof fetch;

  const lines: string[] = [];
  console.log = (msg?: unknown) => lines.push(String(msg));
  console.error = () => {};

  const savedDir = process.env.BOBBY_CLI_PROFILES_DIR;
  const savedAuthCenter = process.env.AUTH_CENTER;
  if (options.profilesDir) process.env.BOBBY_CLI_PROFILES_DIR = options.profilesDir;
  // The workspace exports AUTH_CENTER for its own reasons and it outranks the
  // stored value (config.ts). Left set, every case here would silently target
  // that host instead of the fixture's.
  delete process.env.AUTH_CENTER;

  const program = new Command();
  program.exitOverride();
  program.configureOutput({ writeErr: () => {} });
  registerUploaderCommand(program);

  process.exitCode = 0;
  try {
    await program.parseAsync(["node", "bobby-cli", ...argv]);
  } finally {
    if (savedDir === undefined) delete process.env.BOBBY_CLI_PROFILES_DIR;
    else process.env.BOBBY_CLI_PROFILES_DIR = savedDir;
    if (savedAuthCenter !== undefined) process.env.AUTH_CENTER = savedAuthCenter;
  }

  const exitCode = typeof process.exitCode === "number" ? process.exitCode : 0;
  return { envelope: JSON.parse(lines.join("\n")) as Record<string, unknown>, exitCode, calls };
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const HIT = {
  id: "rec1",
  pb_record_id: "rec1",
  original_name: "hoteltime__reservation__20260415.xlsx",
  description: "Reservation list for 15 Apr 2026",
  document_type: "reservation_list",
  source_system: "hoteltime",
  time_events: [{ start: "2026-04-15" }],
  md_file_url: "https://uploader.test/files/rec1.md",
  score: 0.5,
};

// --- the error table of spec 18 § 6.3, row by row ---------------------------

const ERROR_ROWS: Array<{ status: number; slug: string; code: string; exit: number }> = [
  { status: 401, slug: "unauthorized", code: "not_logged_in", exit: 1 },
  { status: 403, slug: "forbidden", code: "permission_denied", exit: 1 },
  { status: 400, slug: "bad_request", code: "usage", exit: 1 },
  { status: 503, slug: "uploader_not_configured", code: "server", exit: 1 },
  { status: 502, slug: "uploader_auth_failed", code: "server", exit: 1 },
  { status: 502, slug: "uploader_error", code: "server", exit: 1 },
  { status: 502, slug: "uploader_unavailable", code: "server", exit: 1 },
  { status: 429, slug: "too_many_requests", code: "server", exit: 1 },
  { status: 429, slug: "uploader_rate_limited", code: "server", exit: 1 },
];

for (const row of ERROR_ROWS) {
  test(`${row.status} ${row.slug} maps to code ${row.code}`, async () => {
    const profile = makeProfile();
    try {
      const { envelope, exitCode } = await runUploader(
        ["uploader", "search", "reservation", "--profile", "owner", "--json"],
        { responses: [json(row.status, { error: row.slug, message: "upstream said no" })], profilesDir: profile.dir }
      );
      assert.equal(envelope.ok, false);
      assert.equal(envelope.code, row.code);
      // Five server-side conditions share `code: "server"`, so the slug has to
      // survive on its own field or a monitor cannot tell them apart.
      assert.equal(envelope.reason, row.slug);
      assert.ok(typeof envelope.hint === "string" && (envelope.hint as string).length > 0);
      assert.equal(exitCode, row.exit);
    } finally {
      profile.cleanup();
    }
  });
}

test("a dead uploader credential never tells the user to log in", async () => {
  const profile = makeProfile();
  try {
    const { envelope } = await runUploader(
      ["uploader", "search", "x", "--profile", "owner", "--json"],
      { responses: [json(502, { error: "uploader_auth_failed", message: "rejected" })], profilesDir: profile.dir }
    );
    // The user's own token is fine; sending them to `auth login` would be a
    // different identity in a different system and could never fix this.
    assert.equal(envelope.code, "server");
    assert.doesNotMatch(String(envelope.hint), /auth login/);
    assert.match(String(envelope.hint), /administrator/);
  } finally {
    profile.cleanup();
  }
});

test("403 does not send the user to log in either", async () => {
  const profile = makeProfile();
  try {
    const { envelope } = await runUploader(
      ["uploader", "search", "x", "--profile", "owner", "--json"],
      { responses: [json(403, { error: "forbidden", message: "owner only" })], profilesDir: profile.dir }
    );
    assert.equal(envelope.code, "permission_denied");
    assert.doesNotMatch(String(envelope.hint), /auth login/);
  } finally {
    profile.cleanup();
  }
});

test("a 5xx is never retried — one command, one request", async () => {
  const profile = makeProfile();
  try {
    const { calls } = await runUploader(
      ["uploader", "search", "x", "--profile", "owner", "--json"],
      { responses: [json(502, { error: "uploader_unavailable", message: "down" })], profilesDir: profile.dir }
    );
    // auth-center already retries the uploader leg. Retrying here too would
    // multiply the requests reaching someone else's system per typed command.
    assert.equal(calls.length, 1);
  } finally {
    profile.cleanup();
  }
});

test("an unreachable auth-center is a network failure", async () => {
  const profile = makeProfile();
  try {
    const { envelope, exitCode } = await runUploader(
      ["uploader", "search", "x", "--profile", "owner", "--json"],
      { failNetwork: true, profilesDir: profile.dir }
    );
    assert.equal(envelope.code, "network");
    assert.equal(exitCode, 1);
  } finally {
    profile.cleanup();
  }
});

test("a missing profile fails before any network call", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bobby-cli-empty-"));
  try {
    const { envelope, exitCode, calls } = await runUploader(
      ["uploader", "search", "x", "--profile", "absent", "--json"],
      { profilesDir: dir }
    );
    assert.equal(envelope.code, "not_logged_in");
    assert.equal(exitCode, 1);
    assert.equal(calls.length, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- local validation, all before the network (spec 17 § 3.1) ---------------

const BAD_INPUT: Array<{ argv: string[]; why: string }> = [
  { argv: ["uploader", "search", "--document-type", "invoice"], why: "unknown document type" },
  { argv: ["uploader", "search", "--source-system", "sap"], why: "unknown source system" },
  { argv: ["uploader", "search", "x", "--day", "2026-4-1"], why: "day must be YYYY-MM-DD" },
  { argv: ["uploader", "search", "x", "--month", "2026-04-01"], why: "month must be YYYY-MM" },
  { argv: ["uploader", "search", "x", "--date-from", "2026-04-01"], why: "date range needs both ends" },
  { argv: ["uploader", "search", "x", "--day", "2026-04-01", "--month", "2026-04"], why: "date filters are exclusive" },
  { argv: ["uploader", "search", "x", "-n", "0"], why: "limit must be positive" },
  { argv: ["uploader", "search", "x", "-n", "51"], why: "limit is capped at 50" },
  { argv: ["uploader", "search"], why: "needs a query or a filter" },
  { argv: ["uploader", "fetch", "https://uploader.test/files/x.md"], why: "fetch takes an id, not a URL" },
];

for (const { argv, why } of BAD_INPUT) {
  test(`rejected locally as usage: ${why}`, async () => {
    const profile = makeProfile();
    try {
      const { envelope, exitCode, calls } = await runUploader([...argv, "--profile", "owner", "--json"], {
        profilesDir: profile.dir,
      });
      assert.equal(envelope.ok, false, why);
      assert.equal(envelope.code, "usage");
      assert.equal(exitCode, 1);
      assert.equal(calls.length, 0, "validation must run before any network call");
    } finally {
      profile.cleanup();
    }
  });
}

// --- search behaviour --------------------------------------------------------

test("search sends the caller's own token and the allowlisted params", async () => {
  const profile = makeProfile();
  try {
    const { envelope, calls } = await runUploader(
      ["uploader", "search", "reservation", "--document-type", "reservation_list", "--file-type", ".xlsx", "-n", "5", "--profile", "owner", "--json"],
      { responses: [json(200, { ok: true, results: [HIT] })], profilesDir: profile.dir }
    );
    assert.equal(envelope.ok, true);
    assert.equal(envelope.code, "results");
    assert.equal(envelope.count, 1);
    assert.deepEqual(envelope.results, [HIT], "results pass through verbatim");

    const url = new URL(calls[0].url);
    assert.equal(url.origin + url.pathname, "https://auth-center.test/uploader/search");
    assert.equal(url.searchParams.get("query"), "reservation");
    assert.equal(url.searchParams.get("document_type"), "reservation_list");
    // A leading dot is what a person types; both spellings mean the same file.
    assert.equal(url.searchParams.get("file_type"), "xlsx");
    assert.equal(calls[0].authorization, "Bearer sm_live_testtoken");
  } finally {
    profile.cleanup();
  }
});

test("text lists name — description and never leaks the score", async () => {
  const profile = makeProfile();
  try {
    const { envelope } = await runUploader(
      ["uploader", "search", "reservation", "--profile", "owner", "--json"],
      { responses: [json(200, { ok: true, results: [HIT] })], profilesDir: profile.dir }
    );
    const text = String(envelope.text);
    assert.match(text, /1\. hoteltime__reservation__20260415\.xlsx — Reservation list for 15 Apr 2026/);
    assert.match(text, /\(reservation_list · hoteltime · 2026-04-15\)/);
    // An RRF rank read as a percentage is worse than no number at all.
    assert.doesNotMatch(text, /0\.5|score/i);
  } finally {
    profile.cleanup();
  }
});

test("a hit with no markdown is flagged, not hidden", async () => {
  const profile = makeProfile();
  try {
    const { md_file_url, ...noMarkdown } = HIT;
    const { envelope } = await runUploader(
      ["uploader", "search", "reservation", "--profile", "owner", "--json"],
      { responses: [json(200, { ok: true, results: [noMarkdown] })], profilesDir: profile.dir }
    );
    assert.equal(envelope.count, 1, "the file still exists, so search still reports it");
    assert.match(String(envelope.text), /\[markdown not ready\]/);
  } finally {
    profile.cleanup();
  }
});

test("an empty filtered search retries once without the query", async () => {
  const profile = makeProfile();
  try {
    const { envelope, calls } = await runUploader(
      ["uploader", "search", "reservation", "--document-type", "reservation_list", "--profile", "owner", "--json"],
      {
        responses: [json(200, { ok: true, results: [] }), json(200, { ok: true, results: [HIT] })],
        profilesDir: profile.dir,
      }
    );
    assert.equal(envelope.retriedWithoutQuery, true);
    assert.equal(envelope.count, 1);
    // Order flips to date-first without a query — an agent that cannot tell
    // the modes apart will describe a date listing as "the closest matches".
    assert.equal(envelope.mode, "filter_only");
    assert.match(String(envelope.text), /ordered by date/);
    assert.equal(calls.length, 2);
    assert.equal(new URL(calls[1].url).searchParams.get("query"), null);
  } finally {
    profile.cleanup();
  }
});

test("an empty search with no filter is not retried", async () => {
  const profile = makeProfile();
  try {
    const { envelope, calls } = await runUploader(
      ["uploader", "search", "reservation", "--profile", "owner", "--json"],
      { responses: [json(200, { ok: true, results: [] })], profilesDir: profile.dir }
    );
    assert.equal(envelope.ok, true, "zero results is a successful answer");
    assert.equal(envelope.count, 0);
    assert.equal(envelope.retriedWithoutQuery, false);
    assert.equal(calls.length, 1);
  } finally {
    profile.cleanup();
  }
});

test("a full page is marked truncated", async () => {
  const profile = makeProfile();
  try {
    const { envelope } = await runUploader(
      ["uploader", "search", "reservation", "-n", "2", "--profile", "owner", "--json"],
      { responses: [json(200, { ok: true, results: [HIT, { ...HIT, id: "rec2" }] })], profilesDir: profile.dir }
    );
    assert.equal(envelope.truncated, true);
    assert.match(String(envelope.text), /showing the first 2 of possibly more/);
  } finally {
    profile.cleanup();
  }
});

// --- fetch behaviour ---------------------------------------------------------

test("fetch returns the markdown and asks the server for no more than it wants", async () => {
  const profile = makeProfile();
  try {
    const { envelope, calls } = await runUploader(
      ["uploader", "fetch", "rec1", "--max-chars", "500", "--profile", "owner", "--json"],
      {
        responses: [
          json(200, {
            ok: true,
            id: "rec1",
            record: { original_name: "reservations.xlsx", title: "Reservation list" },
            markdown: "# Reservations\nrow one\n",
            chars: 24,
            truncated: false,
          }),
        ],
        profilesDir: profile.dir,
      }
    );
    assert.equal(envelope.ok, true);
    assert.equal(envelope.code, "fetched");
    assert.equal(envelope.originalName, "reservations.xlsx");
    assert.equal(envelope.truncated, false);
    assert.equal(envelope.markdown, "# Reservations\nrow one\n");

    const url = new URL(calls[0].url);
    assert.equal(url.pathname, "/uploader/fetch");
    assert.equal(url.searchParams.get("id"), "rec1");
    // Hauling 200k of markdown to throw away 199.5k of it wastes the whole
    // round trip; the server caps at what we asked for.
    assert.equal(url.searchParams.get("max_chars"), "500");
  } finally {
    profile.cleanup();
  }
});

test("truncation cuts at a line boundary, never mid-row", async () => {
  const profile = makeProfile();
  try {
    const markdown = "| a | b |\n| 1 | 2 |\n| 3 | 4 |\n";
    const { envelope } = await runUploader(
      ["uploader", "fetch", "rec1", "--max-chars", "15", "--profile", "owner", "--json"],
      { responses: [json(200, { ok: true, id: "rec1", record: {}, markdown, truncated: false })], profilesDir: profile.dir }
    );
    assert.equal(envelope.truncated, true);
    // Half a table row is worse than one row fewer.
    assert.equal(envelope.markdown, "| a | b |");
    assert.equal(envelope.chars, 9);
  } finally {
    profile.cleanup();
  }
});

test("a record whose markdown is not ready is not_found with exit 0", async () => {
  const profile = makeProfile();
  try {
    const { envelope, exitCode } = await runUploader(
      ["uploader", "fetch", "rec1", "--profile", "owner", "--json"],
      { responses: [json(200, { ok: true, mdReady: false, id: "rec1" })], profilesDir: profile.dir }
    );
    assert.equal(envelope.ok, true);
    assert.equal(envelope.code, "not_found");
    // The question was answered — "there is nothing to read yet" is not a
    // failure, and an agent must not retry it.
    assert.equal(exitCode, 0);
  } finally {
    profile.cleanup();
  }
});

test("a 404 from auth-center is not_found with exit 0, never a server error", async () => {
  const profile = makeProfile();
  try {
    const { envelope, exitCode } = await runUploader(
      ["uploader", "fetch", "nosuch", "--profile", "owner", "--json"],
      { responses: [json(404, { error: "not_found", message: "No document with that id." })], profilesDir: profile.dir }
    );
    assert.equal(envelope.ok, true);
    assert.equal(envelope.code, "not_found");
    assert.equal(exitCode, 0);
  } finally {
    profile.cleanup();
  }
});

test("a server-side cut is still trimmed back to a whole line", async () => {
  const profile = makeProfile();
  try {
    // auth-center caps the payload at max_chars, so what arrives is already
    // short enough — and ends mid-row. Length alone cannot detect that.
    const { envelope } = await runUploader(
      ["uploader", "fetch", "rec1", "--max-chars", "20", "--profile", "owner", "--json"],
      {
        responses: [
          json(200, {
            ok: true,
            id: "rec1",
            record: {},
            markdown: "| a | b |\n| 1 | 2 | par",
            chars: 20,
            truncated: true,
          }),
        ],
        profilesDir: profile.dir,
      }
    );
    assert.equal(envelope.markdown, "| a | b |");
    assert.equal(envelope.truncated, true);
  } finally {
    profile.cleanup();
  }
});

test("the date in a result line is a date, not a timestamp", async () => {
  const profile = makeProfile();
  try {
    const { envelope } = await runUploader(
      ["uploader", "search", "reservation", "--profile", "owner", "--json"],
      {
        responses: [
          json(200, { ok: true, results: [{ ...HIT, time_events: [{ start: "2024-05-22T17:00:00Z" }] }] }),
        ],
        profilesDir: profile.dir,
      }
    );
    assert.match(String(envelope.text), /· 2024-05-22\)/);
    assert.doesNotMatch(String(envelope.text), /T17:00:00Z/);
  } finally {
    profile.cleanup();
  }
});
