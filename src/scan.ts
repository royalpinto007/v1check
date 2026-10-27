import { constants } from "node:fs";
import { lstat, readdir, realpath, open } from "node:fs/promises";
import { basename, join, relative, sep } from "node:path";
import ignore from "ignore";
import { analyzeSource } from "./source.js";
import { analyzeDependencies } from "./dependencies.js";
import { RULES_DATE } from "./rules.js";
import type { Report } from "./types.js";
const ignored = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  "coverage",
  ".next",
  ".nuxt",
  ".svelte-kit",
  ".turbo",
  ".pnpm-store",
  ".yarn",
  ".cache",
  ".venv",
  "target",
  "ledger",
]);
const manifests = new Set([
  "package.json",
  "package-lock.json",
  "npm-shrinkwrap.json",
  "pnpm-lock.yaml",
  "yarn.lock",
]);
export const clean = (s: string) =>
  Array.from(s, (c) => {
    const n = c.codePointAt(0)!;
    return n < 32 || (n >= 127 && n <= 159) ? "?" : c;
  }).join("");
export async function scan(input: string): Promise<Report> {
  const root = await realpath(input);
  if (!(await lstat(root)).isDirectory())
    throw new Error("Project path must be a directory.");
  const report: Report = {
    project: clean(basename(root)),
    rulesDate: RULES_DATE,
    runtimeVerified: false,
    status: "V1 runtime support not verified",
    complete: true,
    filesScanned: 0,
    warnings: [],
    findings: [],
  };
  const ig = ignore();
  let total = 0,
    visited = 0,
    stopped = false;
  const warn = (message: string) => {
    report.complete = false;
    if (report.warnings.length < 100) report.warnings.push(clean(message));
  };
  async function read(path: string, max: number): Promise<string> {
    const before = await lstat(path);
    if (!before.isFile()) throw new Error("not a regular file");
    const handle = await open(
      path,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size > max)
        throw new Error("size or file type");
      const actual = await realpath(path);
      if (!actual.startsWith(root + sep)) throw new Error("outside root");
      const buffer = Buffer.alloc(Math.min(max + 1, stat.size + 1));
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
      if (bytesRead > max) throw new Error("size");
      total += bytesRead;
      return buffer.subarray(0, bytesRead).toString("utf8");
    } finally {
      await handle.close();
    }
  }
  for (const file of [".gitignore", ".v1checkignore"]) {
    try {
      ig.add(await read(join(root, file), 65536));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT")
        warn(`${file}: ignore rules could not be read.`);
    }
  }
  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > 32) {
      warn(`${relative(root, dir)}: maximum directory depth reached.`);
      return;
    }
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      warn(`${relative(root, dir)}: directory could not be read.`);
      return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name, "en"));
    for (const entry of entries) {
      if (stopped) return;
      if (++visited > 20000) {
        warn("Directory entry limit reached (20000).");
        stopped = true;
        return;
      }
      const path = join(dir, entry.name),
        rel = relative(root, path).split(sep).join("/");
      if (
        ignored.has(entry.name) ||
        ig.ignores(rel + (entry.isDirectory() ? "/" : ""))
      )
        continue;
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        await walk(path, depth + 1);
        continue;
      }
      const dependency = manifests.has(entry.name);
      if (!dependency && !/\.[cm]?[jt]sx?$/.test(entry.name)) continue;
      if (report.filesScanned >= 3000 || total >= 50 * 1024 * 1024) {
        warn("Scan limit reached (3000 files / 50 MiB).");
        stopped = true;
        return;
      }
      try {
        const text = await read(
          path,
          dependency ? 4 * 1024 * 1024 : 1024 * 1024,
        );
        report.filesScanned++;
        const findings = dependency
          ? analyzeDependencies(rel, text)
          : analyzeSource(rel, text);
        report.findings.push(...findings);
        if (findings.some((f) => f.rule === "parse-source"))
          warn(`${rel}: syntax analysis was incomplete.`);
      } catch {
        warn(`${rel}: skipped unreadable, oversized or malformed file.`);
      }
    }
  }
  await walk(root, 0);
  report.findings.sort(
    (a, b) =>
      a.file.localeCompare(b.file, "en") ||
      a.line - b.line ||
      a.column - b.column ||
      a.rule.localeCompare(b.rule),
  );
  for (const finding of report.findings) finding.file = clean(finding.file);
  return report;
}
