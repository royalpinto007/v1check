import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
const run = (...args: string[]) =>
  spawnSync(process.execPath, ["--import", "tsx", "src/cli.ts", ...args], {
    encoding: "utf8",
  });
test("CLI returns actionable status and structured reports", () => {
  assert.equal(run("--version").stdout.trim(), "0.1.0");
  assert.match(run("--help").stdout, /--format/);
  assert.equal(run("--demo").status, 1);
  const result = run("--demo", "--format", "json", "--fail-on", "never");
  assert.equal(result.status, 0);
  assert.equal(JSON.parse(result.stdout).runtimeVerified, false);
  assert.equal(run("--format", "xml").status, 2);
  assert.equal(run("/nonexistent/v1check/path").status, 2);
});
test("explicit exports never overwrite an existing file", async () => {
  const root = await mkdtemp(join(tmpdir(), "v1check-cli-"));
  try {
    const file = join(root, "report.html");
    assert.equal(
      run("--demo", "--format", "html", "--output", file, "--fail-on", "never")
        .status,
      0,
    );
    const before = await readFile(file, "utf8");
    assert.match(before, /<!doctype html>/);
    assert.equal(run("--demo", "--output", file).status, 2);
    assert.equal(await readFile(file, "utf8"), before);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("named pipes cannot block source or ignore reads", async () => {
  const root = await mkdtemp(join(tmpdir(), "v1check-fifo-"));
  try {
    spawnSync("mkfifo", [join(root, ".gitignore"), join(root, "app.ts")]);
    const result = spawnSync(
      process.execPath,
      ["--import", "tsx", "src/cli.ts", root, "--format", "json"],
      { encoding: "utf8", timeout: 2000 },
    );
    assert.equal(result.error, undefined);
    assert.equal(JSON.parse(result.stdout).complete, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
