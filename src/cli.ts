#!/usr/bin/env node
import { parseArgs } from "node:util";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { scan } from "./scan.js";
import { render } from "./report.js";
try {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      help: { type: "boolean", short: "h" },
      version: { type: "boolean" },
      demo: { type: "boolean" },
      format: { type: "string", default: "text" },
      output: { type: "string" },
      "fail-on": { type: "string", default: "error" },
    },
  });
  if (values.help)
    console.log(
      "v1check [project-directory]\n\nRead-only, offline Solana V1 checks.\n  --demo                  Scan the bundled fictional project\n  --format text|markdown|json|html\n  --output PATH           Create a report; refuses existing files\n  --fail-on error|review|never\n  --version\n\nExit: 0 below threshold, 1 findings/partial scan, 2 usage or I/O error.\nStatic checks never verify runtime V1 compatibility.",
    );
  else if (values.version)
    console.log(
      (
        JSON.parse(
          await readFile(new URL("../package.json", import.meta.url), "utf8"),
        ) as { version: string }
      ).version,
    );
  else {
    if (
      positionals.length > 1 ||
      !["text", "markdown", "json", "html"].includes(values.format!) ||
      !["error", "review", "never"].includes(values["fail-on"]!)
    )
      throw new Error("Invalid arguments. Run v1check --help.");
    if (values.demo && positionals.length)
      throw new Error("Choose --demo or a project directory.");
    const report = await scan(
      values.demo
        ? fileURLToPath(new URL("../fixtures/demo", import.meta.url))
        : (positionals[0] ?? "."),
    );
    const output = render(report, values.format!);
    if (values.output) {
      await writeFile(values.output, output, { flag: "wx", mode: 0o600 });
      console.error("Report created.");
    } else process.stdout.write(output);
    process.exitCode =
      values["fail-on"] === "never"
        ? 0
        : !report.complete ||
            report.findings.some(
              (f) =>
                f.severity === "error" ||
                (values["fail-on"] === "review" && f.severity === "review"),
            )
          ? 1
          : 0;
  }
} catch (error) {
  const code = (error as NodeJS.ErrnoException).code;
  console.error(
    code === "EEXIST"
      ? "Report already exists. Choose a new output path."
      : code === "ENOENT"
        ? "Project or output directory does not exist."
        : error instanceof Error && !code
          ? error.message
          : "Unable to read project or write report.",
  );
  process.exitCode = 2;
}
