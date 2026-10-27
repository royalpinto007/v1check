import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  writeFile,
  mkdir,
  symlink,
  readFile,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scan } from "../src/scan.js";
import { analyzeSource } from "../src/source.js";
import { assessVersion } from "../src/rules.js";
import { render } from "../src/report.js";

const pre = `import { Connection as C } from '@solana/web3.js'; const rpc = new C('url');\n`;
for (const [body, severity] of [
  ["rpc.getTransaction(sig, {maxSupportedTransactionVersion: 0});", "error"],
  ["rpc.getBlock(slot, {maxSupportedTransactionVersion: 1});", "info"],
  ["rpc.getTransaction(sig);", "review"],
  ['rpc.getTransaction(sig, {maxSupportedTransactionVersion: "1"});', "error"],
  [
    "const v=0; rpc.getTransaction(sig, {maxSupportedTransactionVersion: v});",
    "error",
  ],
  [
    "rpc.getBlock(slot, {...unknown, maxSupportedTransactionVersion: 0});",
    "error",
  ],
  [
    "rpc.getBlock(slot, {maxSupportedTransactionVersion: 0, ...unknown});",
    "review",
  ],
  [
    "const opts={maxSupportedTransactionVersion:0}; opts.maxSupportedTransactionVersion=1; rpc.getBlock(slot,opts);",
    "review",
  ],
  [
    "function f(rpc: Other){rpc.getBlock(slot,{maxSupportedTransactionVersion:0});}",
    "none",
  ],
  [
    '// rpc.getBlock(slot, {maxSupportedTransactionVersion:0});\nconst text="getTransaction maxSupportedTransactionVersion:0";',
    "none",
  ],
  [
    "const db={getTransaction(){}}; db.getTransaction(sig,{maxSupportedTransactionVersion:0});",
    "none",
  ],
] as const)
  test(`RPC analysis: ${body}`, () => {
    const findings = analyzeSource("app.ts", pre + body);
    assert.equal(findings[0]?.severity ?? "none", severity);
    if (findings.length) assert.equal(findings[0]?.line, 2);
  });
test("recognizes namespace clients, aliases and raw JSON RPC", () => {
  for (const source of [
    `import * as web3 from '@solana/web3.js'; const c=new web3.Connection('x'); const alias=c; alias.getBlock(1,{maxSupportedTransactionVersion:0});`,
    `import {createSolanaRpc} from '@solana/kit'; const c=createSolanaRpc('x'); c.getTransaction('x',{maxSupportedTransactionVersion:0});`,
    `const req={jsonrpc:'2.0',method:'getTransaction',params:['sig',{maxSupportedTransactionVersion:0}]};`,
  ])
    assert.equal(analyzeSource("app.ts", source)[0]?.severity, "error");
});
for (const [name, version, severity] of [
  ["@solana/web3.js", "1.98.4", "error"],
  ["@solana/web3.js", "1.99.0", "info"],
  ["@solana/web3.js", "3.0.1", "error"],
  ["@solana/web3.js", "3.0.2", "info"],
  ["@solana/web3.js", "^1.98.4", "review"],
  ["@solana/web3.js", "~1.98.4", "error"],
  ["@solana/web3.js", "2.0.0", "review"],
  ["@solana/web3.js", "3.0.0-rc.3", "review"],
  ["@solana/kit", "7.0.0", "error"],
  ["@solana/kit", "8.0.0", "info"],
  ["@solana/wallet-standard-features", "1.4.0", "error"],
  ["@solana/kit", "git+https://user:SECRET@example.test/repo", "review"],
] as const)
  test(`SDK ${name} ${version}`, () => {
    const result = assessVersion(name, version);
    assert.equal(result?.severity, severity);
    assert.ok(!JSON.stringify(result).includes("SECRET"));
  });
async function project(
  files: Record<string, string>,
  run: (root: string) => Promise<void>,
) {
  const root = await mkdtemp(join(tmpdir(), "v1check-test-"));
  try {
    for (const [file, text] of Object.entries(files)) {
      await mkdir(join(root, file, ".."), { recursive: true });
      await writeFile(join(root, file), text);
    }
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
test("scans workspaces and locks, excludes secrets, dependencies and symlinks", async () => {
  await project(
    {
      "package.json": JSON.stringify({
        dependencies: { "@solana/web3.js": "^1.98.4" },
        scripts: { prepare: "touch SHOULD_NOT_EXIST" },
      }),
      "package-lock.json": JSON.stringify(
        {
          lockfileVersion: 3,
          packages: { "node_modules/@solana/web3.js": { version: "1.98.4" } },
        },
        null,
        2,
      ),
      "packages/a/package.json": JSON.stringify({
        dependencies: { "@solana/kit": "8.0.0" },
      }),
      "src/app.ts": pre + "rpc.getBlock(1,{maxSupportedTransactionVersion:0});",
      ".env": "SECRET=hidden",
      "node_modules/bad.ts": pre + "rpc.getBlock(1);",
      ".gitignore": "ignored/\n",
      "ignored/bad.ts": pre + "rpc.getBlock(1);",
    },
    async (root) => {
      await symlink("/etc/passwd", join(root, "external.ts"));
      const before = await readFile(join(root, "src/app.ts"), "utf8");
      const report = await scan(root);
      assert.equal(
        report.findings.filter((f) => f.rule === "rpc-version").length,
        1,
      );
      assert.ok(
        report.findings.some(
          (f) =>
            f.file === "package-lock.json" &&
            f.severity === "error" &&
            f.line > 1,
        ),
      );
      assert.ok(
        report.findings.some((f) => f.file === "packages/a/package.json"),
      );
      assert.ok(!JSON.stringify(report).includes("hidden"));
      assert.equal(await readFile(join(root, "src/app.ts"), "utf8"), before);
      assert.equal(report.runtimeVerified, false);
    },
  );
});
test("Yarn classic, Berry and pnpm lock versions are inspected", async () => {
  for (const [file, body] of [
    ["yarn.lock", '"@solana/kit@^7.0.0":\n  version "7.1.0"\n'],
    [
      "yarn.lock",
      '__metadata:\n  version: 8\n"@solana/kit@npm:^7.0.0":\n  version: 7.1.0\n',
    ],
    [
      "pnpm-lock.yaml",
      "lockfileVersion: '9.0'\npackages:\n  '@solana/kit@7.1.0': {}\n",
    ],
    [
      "pnpm-lock.yaml",
      "lockfileVersion: 5.4\npackages:\n  /@solana/kit/7.1.0: {}\n",
    ],
  ])
    await project({ [file!]: body! }, async (root) => {
      assert.ok(
        (await scan(root)).findings.some((f) => f.severity === "error"),
      );
    });
});
test("malformed and oversized files visibly reduce scan coverage", async () => {
  await project(
    { "package.json": "{", "huge.ts": "x".repeat(1_048_577) },
    async (root) => {
      const report = await scan(root);
      assert.equal(report.complete, false);
      assert.ok(report.warnings.length >= 2);
    },
  );
});
test("reports escape HTML and expose static limitations without source content", async () => {
  await project({ "app.ts": pre + "rpc.getBlock(1);" }, async (root) => {
    const report = await scan(root);
    report.project = "<img src=x onerror=alert(1)>";
    const html = render(report, "html");
    assert.ok(html.includes("&lt;img"));
    assert.ok(!html.includes("<img"));
    assert.ok(!html.includes("<script"));
    for (const format of ["text", "markdown", "html", "json"] as const)
      assert.ok(render(report, format).includes("not verified"));
  });
});
test("pnpm v6 scoped slash-at package keys are checked", async () => {
  await project(
    {
      "pnpm-lock.yaml":
        "lockfileVersion: '6.0'\npackages:\n  /@solana/kit@7.1.0: {}\n",
    },
    async (root) => {
      assert.ok(
        (await scan(root)).findings.some((f) => f.severity === "error"),
      );
    },
  );
});
for (const [value, severity] of [
  ["+1", "info"],
  ["+0", "error"],
  ["-1", "error"],
  ["+process.env.VERSION", "review"],
] as const)
  test(`unary version ${value} is assessed honestly`, () => {
    assert.equal(
      analyzeSource(
        "app.ts",
        pre + `rpc.getBlock(1,{maxSupportedTransactionVersion:${value}});`,
      )[0]?.severity,
      severity,
    );
  });
