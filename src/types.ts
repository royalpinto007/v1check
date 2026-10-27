export type Severity = "error" | "review" | "info";
export interface Finding {
  rule: string;
  severity: Severity;
  confidence: "confirmed" | "heuristic";
  file: string;
  line: number;
  column: number;
  message: string;
  fix: string;
  source: string;
}
export interface Report {
  project: string;
  rulesDate: string;
  runtimeVerified: false;
  status: string;
  complete: boolean;
  filesScanned: number;
  warnings: string[];
  findings: Finding[];
}
