import ts from "typescript";
import type { Finding } from "./types.js";
import { SOURCE } from "./rules.js";
const readers = new Set([
  "getTransaction",
  "getParsedTransaction",
  "getTransactions",
  "getParsedTransactions",
  "getBlock",
  "getParsedBlock",
  "blockSubscribe",
]);
export function analyzeSource(file: string, text: string): Finding[] {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const options: ts.CompilerOptions = {
    noLib: true,
    noResolve: true,
    allowJs: true,
  };
  const host: ts.CompilerHost = {
    getSourceFile: (name) => (name === file ? sf : undefined),
    writeFile: () => {},
    getCurrentDirectory: () => "",
    getDirectories: () => [],
    getCanonicalFileName: (f) => f,
    useCaseSensitiveFileNames: () => true,
    getNewLine: () => "\n",
    fileExists: (f) => f === file,
    readFile: (f) => (f === file ? text : undefined),
    getDefaultLibFileName: () => "",
  };
  const program = ts.createProgram([file], options, host);
  const checker = program.getTypeChecker();
  const findings: Finding[] = [];
  const unwrap = (e: ts.Expression): ts.Expression =>
    ts.isParenthesizedExpression(e) ||
    ts.isAsExpression(e) ||
    ts.isSatisfiesExpression(e) ||
    ts.isNonNullExpression(e)
      ? unwrap(e.expression)
      : e;
  function declaration(e: ts.Identifier) {
    return checker.getSymbolAtLocation(e)?.declarations?.[0];
  }
  function constant(e: ts.Expression, depth = 0): ts.Expression {
    e = unwrap(e);
    if (depth > 10) return e;
    if (ts.isIdentifier(e)) {
      const d = declaration(e);
      if (
        d &&
        ts.isVariableDeclaration(d) &&
        d.initializer &&
        ts.isVariableDeclarationList(d.parent) &&
        d.parent.flags & ts.NodeFlags.Const
      )
        return constant(d.initializer, depth + 1);
    }
    return e;
  }
  function imported(e: ts.Expression, name: string): boolean {
    e = unwrap(e);
    if (ts.isIdentifier(e)) {
      const d = declaration(e);
      if (d && ts.isImportSpecifier(d)) {
        const imp = d.parent.parent.parent;
        return (
          ts.isImportDeclaration(imp) &&
          ts.isStringLiteral(imp.moduleSpecifier) &&
          /^@solana\/(web3\.js|kit|rpc|rpc-subscriptions)$/.test(
            imp.moduleSpecifier.text,
          ) &&
          (d.propertyName ?? d.name).text === name
        );
      }
    }
    if (
      ts.isPropertyAccessExpression(e) &&
      e.name.text === name &&
      ts.isIdentifier(e.expression)
    ) {
      const d = declaration(e.expression);
      if (d && ts.isNamespaceImport(d)) {
        const imp = d.parent.parent;
        return (
          ts.isImportDeclaration(imp) &&
          ts.isStringLiteral(imp.moduleSpecifier) &&
          imp.moduleSpecifier.text.startsWith("@solana/")
        );
      }
    }
    return false;
  }
  function client(e: ts.Expression, depth = 0): boolean {
    if (depth > 10) return false;
    e = unwrap(e);
    if (ts.isIdentifier(e)) {
      const d = declaration(e);
      return (
        !!d &&
        ts.isVariableDeclaration(d) &&
        !!d.initializer &&
        ts.isVariableDeclarationList(d.parent) &&
        !!(d.parent.flags & ts.NodeFlags.Const) &&
        client(d.initializer, depth + 1)
      );
    }
    if (ts.isNewExpression(e)) return imported(e.expression, "Connection");
    return (
      ts.isCallExpression(e) &&
      ["createSolanaRpc", "createSolanaRpcSubscriptions"].some((n) =>
        imported(e.expression, n),
      )
    );
  }
  const key = (n: ts.PropertyName) =>
    ts.isIdentifier(n) || ts.isStringLiteral(n) || ts.isNumericLiteral(n)
      ? n.text
      : undefined;
  function property(
    o: ts.ObjectLiteralExpression,
    name: string,
  ): ts.Expression | "unknown" | undefined {
    let found: ts.Expression | "unknown" | undefined;
    for (const p of o.properties) {
      if (ts.isSpreadAssignment(p)) {
        const s = unwrap(p.expression);
        const value = ts.isObjectLiteralExpression(s)
          ? property(s, name)
          : "unknown";
        if (value !== undefined) found = value;
      } else if (!p.name || key(p.name) === undefined) found = "unknown";
      else if (key(p.name) === name) {
        found = ts.isPropertyAssignment(p)
          ? p.initializer
          : ts.isShorthandPropertyAssignment(p)
            ? p.name
            : "unknown";
      }
    }
    return found;
  }
  function add(
    n: ts.Node,
    severity: Finding["severity"],
    message: string,
    rule = "rpc-version",
    fix = "For V1 reads, use numeric maxSupportedTransactionVersion: 1 after checking SDK and RPC support.",
    confidence: Finding["confidence"] = "confirmed",
  ) {
    const at = sf.getLineAndCharacterOfPosition(n.getStart(sf));
    findings.push({
      rule,
      severity,
      confidence,
      file,
      line: at.line + 1,
      column: at.character + 1,
      message,
      fix,
      source: SOURCE,
    });
  }
  function inspect(n: ts.Node, opts: ts.Expression | undefined) {
    if (!opts) {
      add(
        n,
        "review",
        "No explicit transaction-version option is visible. Check SDK defaults and wrappers.",
      );
      return;
    }
    opts = unwrap(opts);
    if (!ts.isObjectLiteralExpression(opts)) {
      add(
        n,
        "review",
        "Dynamic options need manual inspection. Mutable objects are not evaluated.",
      );
      return;
    }
    const prop = property(opts, "maxSupportedTransactionVersion");
    if (prop === undefined) {
      add(
        n,
        "review",
        "No maxSupportedTransactionVersion is visible in this options literal.",
      );
      return;
    }
    if (prop === "unknown") {
      add(
        n,
        "review",
        "A spread or computed property can change the transaction-version setting.",
      );
      return;
    }
    const value = constant(prop);
    const literal = ts.isNumericLiteral(value)
      ? Number(value.text)
      : ts.isPrefixUnaryExpression(value) &&
          ts.isNumericLiteral(value.operand) &&
          (value.operator === ts.SyntaxKind.PlusToken ||
            value.operator === ts.SyntaxKind.MinusToken)
        ? Number(value.operand.text) *
          (value.operator === ts.SyntaxKind.MinusToken ? -1 : 1)
        : undefined;
    if (literal !== undefined) {
      const v = literal;
      if (v < 0 || !Number.isInteger(v)) {
        add(
          n,
          "error",
          "Transaction-version option must be a non-negative integer.",
        );
        return;
      }
      if (v === 1)
        add(
          n,
          "info",
          "Explicit numeric V1 read opt-in found. Runtime decoding is not verified.",
        );
      else if (v === 0)
        add(
          n,
          "error",
          "maxSupportedTransactionVersion: 0 excludes V1 transactions.",
        );
      else
        add(
          n,
          "review",
          "Transaction version is outside the verified V1 setting.",
        );
    } else if (
      ts.isStringLiteral(value) ||
      value.kind === ts.SyntaxKind.NullKeyword ||
      value.kind === ts.SyntaxKind.TrueKeyword ||
      value.kind === ts.SyntaxKind.FalseKeyword
    )
      add(
        n,
        "error",
        "Transaction-version option must be a supported non-negative integer, not this literal.",
      );
    else
      add(
        n,
        "review",
        "Transaction version is computed at runtime. Verify it allows V1.",
      );
  }
  function visit(n: ts.Node) {
    if (
      ts.isCallExpression(n) &&
      ts.isPropertyAccessExpression(n.expression) &&
      readers.has(n.expression.name.text) &&
      client(n.expression.expression)
    )
      inspect(n, n.arguments[1]);
    if (ts.isObjectLiteralExpression(n)) {
      const method = property(n, "method"),
        json = property(n, "jsonrpc"),
        params = property(n, "params");
      if (
        method &&
        method !== "unknown" &&
        ts.isStringLiteral(method) &&
        readers.has(method.text) &&
        json &&
        json !== "unknown" &&
        ts.isStringLiteral(json) &&
        json.text === "2.0"
      ) {
        inspect(
          n,
          params && params !== "unknown" && ts.isArrayLiteralExpression(params)
            ? (params.elements[1] as ts.Expression | undefined)
            : undefined,
        );
      }
    }
    if (
      ts.isCallExpression(n) &&
      ts.isPropertyAccessExpression(n.expression) &&
      ["setComputeUnitLimit", "setComputeUnitPrice"].includes(
        n.expression.name.text,
      ) &&
      imported(n.expression.expression, "ComputeBudgetProgram")
    )
      add(
        n,
        "review",
        "Compute Budget instructions configure legacy/v0. V1 uses transactionConfig with different fee units.",
        "v1-config",
        "If constructing V1, explicitly set its compute and data limits and use absolute lamports for priority fees.",
        "heuristic",
      );
    ts.forEachChild(n, visit);
  }
  visit(sf);
  for (const d of program.getSyntacticDiagnostics(sf))
    add(
      sf,
      "review",
      `Source syntax could not be fully parsed (${d.code}).`,
      "parse-source",
      "Fix syntax or inspect this file manually.",
    );
  return findings;
}
