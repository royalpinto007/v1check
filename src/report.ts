import type { Report } from "./types.js";
const html = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
const md = (s: string) => s.replace(/[\\`*_[\]<>|]/g, "\\$&");
export function render(report: Report, format: string): string {
  if (format === "json") return JSON.stringify(report, null, 2) + "\n";
  const count = (severity: string) =>
    report.findings.filter((f) => f.severity === severity).length;
  const checklist =
    "Test a real V1 transaction with your SDK and RPC. Check dynamic wrappers, wallet negotiation, V1 compute/data limits and absolute-lamport priority fees. Legacy and v0 remain valid.";
  if (format === "html")
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>v1check · ${html(report.project)}</title><style>
 :root{color-scheme:dark;font:15px/1.6 ui-sans-serif,system-ui,sans-serif;background:#101113;color:#e6e8e9}*{box-sizing:border-box}body{margin:0}main{max-width:1100px;margin:auto;padding:48px 28px}header{display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #303236;padding-bottom:24px}.brand{font-size:23px;font-weight:750;letter-spacing:-1px}.brand span{color:#b8f07c}small,.muted{color:#a9afb6}h1{font-size:clamp(34px,6vw,58px);line-height:1.1;letter-spacing:-2px;margin:48px 0 16px}h2{font-size:20px}p{max-width:76ch}a{color:#c4e99d;text-underline-offset:4px}code{font:13px ui-monospace,monospace;overflow-wrap:anywhere}.summary{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin:36px 0}.stat{padding:20px;background:#1a1c1f;border:1px solid #303236;border-radius:12px}.stat strong{display:block;font-size:36px;line-height:1.2}.notice{border-left:3px solid #b8f07c;padding:12px 20px;background:#1a2119;border-radius:0 8px 8px 0}.findings{padding:0;list-style:none}.finding{margin:14px 0;padding:24px;border:1px solid #303236;border-radius:12px;background:#181a1d}.meta{display:flex;gap:14px;flex-wrap:wrap;align-items:center}.badge{text-transform:uppercase;letter-spacing:1px;font-size:11px;font-weight:750;padding:3px 9px;border-radius:5px;background:#293126;color:#c4e99d}.error{background:#392329;color:#ffb1be}.review{background:#352f20;color:#f0d197}.finding h3{font-size:17px;line-height:1.5;margin-bottom:10px}.finding p{color:#b3bac2;margin-top:8px}footer{margin-top:40px;border-top:1px solid #303236;padding-top:20px}@media(max-width:600px){main{padding:24px 16px}.summary{gap:8px}.stat{padding:12px}.stat strong{font-size:29px}header{align-items:flex-start;gap:20px}.finding{padding:18px}h1{margin-top:36px}}
 </style></head><body><main><header><div class="brand">v1<span>check</span></div><small>OFFLINE COMPATIBILITY SCAN<br>Rules: ${report.rulesDate}</small></header><h1>Inspect the migration.<br>Know what needs a look.</h1><p class="muted">Project: <code>${html(report.project)}</code> · ${report.filesScanned} files scanned · ${report.complete ? "Scan completed within limits" : "Partial scan"}</p><div class="summary">${[
   ["error", "Findings"],
   ["review", "Need review"],
   ["info", "Observations"],
 ]
   .map(
     ([s, label]) =>
       `<div class="stat"><strong>${count(s!)}</strong>${label}</div>`,
   )
   .join(
     "",
   )}</div><div class="notice"><strong>V1 runtime support not verified</strong><br>This is a static review, never a compatibility certificate.</div><h2>Diagnostics</h2><ol class="findings">${report.findings.map((f) => `<li class="finding"><div class="meta"><span class="badge ${f.severity}">${f.severity}</span><code>${html(f.file)}:${f.line}:${f.column}</code><small>${f.confidence}</small></div><h3>${html(f.message)}</h3><p>${html(f.fix)}</p><a href="${html(f.source)}">Official rule source ↗</a></li>`).join("") || '<li class="finding">No supported patterns produced findings. Unrecognized code still needs manual review.</li>'}</ol>${report.warnings.length ? `<h2>Coverage limits</h2><ul>${report.warnings.map((w) => `<li>${html(w)}</li>`).join("")}</ul>` : ""}<h2>Before calling it ready</h2><p class="muted">${checklist}</p><footer><small>Read-only · No wallet · No network calls · No source snippets included</small></footer></main></body></html>`;
  if (format === "markdown")
    return `# v1check: ${md(report.project)}\n\n**V1 runtime support not verified.** Static checks only. Rules: ${report.rulesDate}. Files: ${report.filesScanned}. ${report.complete ? "" : "Partial scan."}\n\n${report.findings.map((f) => `- **${f.severity}** ${md(f.file)}:${f.line}:${f.column}: ${md(f.message)}\n  ${md(f.fix)} [Official source](${f.source})`).join("\n\n") || "No findings from supported patterns."}\n\n${report.warnings.map((w) => `- Coverage: ${md(w)}`).join("\n")}\n\n${checklist}\n`;
  return `v1check · ${report.project}\nV1 runtime support not verified. Static checks only.\nRules ${report.rulesDate} · ${report.filesScanned} files · ${count("error")} errors · ${count("review")} reviews\n${report.complete ? "" : "PARTIAL SCAN\n"}\n${report.findings.map((f) => `${f.severity.toUpperCase()} ${f.file}:${f.line}:${f.column}\n  ${f.message}\n  ${f.fix}`).join("\n\n") || "No findings from supported patterns."}\n\n${report.warnings.join("\n")}\n${checklist}\n`;
}
