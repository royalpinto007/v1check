import ts from "typescript";
import { parseDocument, isMap, isScalar, LineCounter } from "yaml";
import { assessVersion, SDKS, SOURCE } from "./rules.js";
import type { Finding } from "./types.js";
export function analyzeDependencies(file: string, text: string): Finding[] {
  const result: Finding[] = [];
  function add(name: string, version: unknown, line: number, column = 1) {
    if (typeof version !== "string") return;
    const rule = assessVersion(name, version);
    if (rule)
      result.push({
        rule: "sdk-version",
        confidence: "confirmed",
        file,
        line,
        column,
        source: SOURCE,
        ...rule,
      });
  }
  if (file.endsWith(".json")) {
    JSON.parse(text); // Reject malformed input rather than silently accepting a partial AST.
    const sf = ts.parseJsonText(file, text);
    const name = (p: ts.PropertyAssignment) =>
      ts.isStringLiteral(p.name) ? p.name.text : undefined;
    function visit(n: ts.Node) {
      if (ts.isPropertyAssignment(n)) {
        const k = name(n);
        let sdk = k;
        if (k?.includes("node_modules/"))
          sdk = SDKS.find((s) => k.endsWith(`node_modules/${s}`));
        if (sdk && SDKS.includes(sdk)) {
          let version: ts.Expression | undefined = n.initializer;
          if (ts.isObjectLiteralExpression(version))
            version = version.properties.find(
              (p): p is ts.PropertyAssignment =>
                ts.isPropertyAssignment(p) && name(p) === "version",
            )?.initializer;
          if (version && ts.isStringLiteral(version)) {
            const pos = sf.getLineAndCharacterOfPosition(version.getStart(sf));
            add(sdk, version.text, pos.line + 1, pos.character + 1);
          }
        }
      }
      ts.forEachChild(n, visit);
    }
    visit(sf);
    return result;
  }
  if (file.endsWith("yarn.lock") && !/^__metadata:/m.test(text)) {
    let names: string[] = [];
    text.split(/\r?\n/).forEach((line, index) => {
      if (/^\S/.test(line) && line.trimEnd().endsWith(":"))
        names = SDKS.filter((n) => line.includes(`${n}@`));
      const m = /^\s+version\s+"([^"\n]+)"/.exec(line);
      if (m) for (const n of names) add(n, m[1], index + 1);
    });
    return result;
  }
  const lines = new LineCounter();
  const doc = parseDocument(text, { lineCounter: lines, uniqueKeys: true });
  if (doc.errors.length) throw new Error("Malformed YAML lockfile");
  // Expansion is deliberately bounded even though only keys and scalar versions are needed.
  doc.toJS({ maxAliasCount: 20 });
  const root = doc.contents;
  if (!isMap(root)) throw new Error("Unsupported lockfile shape");
  if (file.endsWith("pnpm-lock.yaml")) {
    const packages = root.get("packages", true);
    if (!isMap(packages)) return result;
    for (const p of packages.items) {
      if (!isScalar(p.key) || typeof p.key.value !== "string") continue;
      const k = p.key.value;
      for (const sdk of SDKS) {
        const prefix = [`/${sdk}/`, `/${sdk}@`, `${sdk}@`].find((p) =>
          k.startsWith(p),
        );
        if (prefix)
          add(
            sdk,
            k.slice(prefix.length).split("(")[0],
            lines.linePos(p.key.range?.[0] ?? 0).line,
          );
      }
    }
  } else {
    for (const p of root.items) {
      if (
        !isScalar(p.key) ||
        typeof p.key.value !== "string" ||
        !isMap(p.value)
      )
        continue;
      const version = p.value.get("version", true);
      if (!isScalar(version)) continue;
      for (const sdk of SDKS)
        if (p.key.value.includes(`${sdk}@`))
          add(
            sdk,
            String(version.value),
            lines.linePos(version.range?.[0] ?? 0).line,
          );
    }
  }
  return result;
}
