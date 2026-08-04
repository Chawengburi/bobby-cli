// Verifies what `npm publish` would actually upload, before it can reach the
// registry: no secrets, no test scaffolding, and the binary the `bin` entry
// points at is really in there.
//
// Reads `npm pack --dry-run --json` rather than grepping npm's human output.
// The first version of this check did grep, and it failed OPEN — the pattern
// pinned a single literal space between the size column and the filename, so
// any change to npm's column padding (setup-node installs whatever npm ships
// with the Node major, unpinned) would have silently stopped detecting a
// leaked .env while still reporting success.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf-8"));

const out = execFileSync("npm", ["pack", "--dry-run", "--json"], { encoding: "utf-8" });
const files = JSON.parse(out)[0].files.map((f) => f.path);

const errors = [];

// Anything that could carry a credential or a private URL.
const FORBIDDEN = [/^\.env$/, /^\.env\.local$/, /(^|\/)credentials\.json$/, /(^|\/)\.npmrc$/];
for (const path of files) {
  if (FORBIDDEN.some((re) => re.test(path))) errors.push(`secret-bearing file in tarball: ${path}`);
}

// Test scaffolding is excluded by the `files` allowlist today; this fails the
// build if someone widens `files` without thinking about it.
for (const path of files) {
  if (/^(test|\.test-build)\//.test(path)) errors.push(`test file in tarball: ${path}`);
}

// The published package is unusable if the bin target is missing — the failure
// mode is `bobby-cli: command not found` for every installer.
const binTarget = typeof pkg.bin === "string" ? pkg.bin : Object.values(pkg.bin ?? {})[0];
if (!binTarget) {
  errors.push("package.json declares no bin entry");
} else if (!files.includes(binTarget.replace(/^\.\//, ""))) {
  errors.push(`bin target missing from tarball: ${binTarget}`);
}

if (errors.length > 0) {
  for (const e of errors) console.error(`::error::${e}`);
  console.error(`\n${files.length} files would be published:\n${files.join("\n")}`);
  process.exit(1);
}

console.log(`pack check OK — ${files.length} files, bin target ${binTarget} present`);
