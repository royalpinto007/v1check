import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";
const consumer = mkdtempSync(join(tmpdir(), "v1check-package-"));
const run = (cmd, args, cwd = consumer) =>
  execFileSync(cmd, args, {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      npm_config_audit: "false",
      npm_config_fund: "false",
    },
  });
try {
  const [pack] = JSON.parse(
    run(
      "npm",
      ["pack", "--json", "--pack-destination", consumer],
      process.cwd(),
    ),
  );
  assert.ok(
    pack.files.every(
      (f) => !/(^|\/)(\.env|node_modules|tests|src)(\/|$)/.test(f.path),
    ),
  );
  run("npm", [
    "install",
    "--ignore-scripts",
    "--omit=dev",
    join(consumer, pack.filename),
  ]);
  const bin = resolve(consumer, "node_modules/.bin/v1check");
  assert.equal(run(bin, ["--version"]).trim(), "0.1.0");
  assert.match(run(bin, ["--help"]), /--format/);
  const report = JSON.parse(
    run(bin, ["--demo", "--format", "json", "--fail-on", "never"]),
  );
  assert.ok(report.findings.some((f) => f.severity === "error"));
  assert.equal(report.runtimeVerified, false);
  run(bin, [
    "--demo",
    "--format",
    "html",
    "--output",
    "report.html",
    "--fail-on",
    "never",
  ]);
  assert.match(
    readFileSync(join(consumer, "report.html"), "utf8"),
    /not verified/,
  );
  run("npm", ["audit", "--omit=dev", "--audit-level=low"]);
  const output = process.argv.indexOf("--output");
  if (output >= 0) {
    const { copyFileSync, mkdirSync } = await import("node:fs");
    const { dirname } = await import("node:path");
    const destination = resolve(process.argv[output + 1]);
    mkdirSync(dirname(destination), { recursive: true });
    copyFileSync(join(consumer, pack.filename), destination);
  }
  console.log(
    `Packed CLI passed: ${pack.files.length} files, ${pack.unpackedSize} bytes.`,
  );
} finally {
  rmSync(consumer, { recursive: true, force: true });
}
