import semver from "semver";
import type { Severity } from "./types.js";
export const RULES_DATE = "2026-10-27";
export const SOURCE = "https://solana.com/upgrades/larger-transaction-sizes";
export const SDKS = [
  "@solana/web3.js",
  "@solana/kit",
  "@solana/wallet-standard-features",
  "@triton-one/yellowstone-grpc",
];
const supported: Record<string, string> = {
  "@solana/web3.js": ">=1.99.0 <2.0.0 || >=3.0.2 <4.0.0",
  "@solana/kit": ">=8.0.0 <9.0.0",
  "@solana/wallet-standard-features": ">=1.5.0 <2.0.0",
  "@triton-one/yellowstone-grpc": ">=6.0.0 <7.0.0",
};
export function assessVersion(
  name: string,
  version: string,
): { severity: Severity; message: string; fix: string } | undefined {
  const range = supported[name];
  if (!range) return;
  const fix = `Check the dated SDK matrix and test V1 decoding. Verified range: ${range}.`;
  const parsed = semver.valid(version);
  if (parsed && semver.prerelease(parsed))
    return {
      severity: "review",
      message: `${name}: prerelease support needs manual verification.`,
      fix,
    };
  const input = semver.validRange(version);
  if (!input)
    return {
      severity: "review",
      message: `${name}: unresolved or non-semver dependency.`,
      fix,
    };
  const minimum = semver.minVersion(input);
  if (!minimum)
    return {
      severity: "review",
      message: `${name}: cannot determine version bounds.`,
      fix,
    };
  const major = minimum.major;
  const knownMajor =
    name === "@solana/web3.js"
      ? major === 1 || major === 3
      : major <= Number(range.match(/>=([0-9]+)/)?.[1]);
  if (!knownMajor)
    return {
      severity: "review",
      message: `${name}: version family is outside the verified matrix.`,
      fix,
    };
  if (!semver.intersects(input, range))
    return {
      severity: "error",
      message: `${name}: ${parsed ? "version" : "declared range"} excludes verified stable V1 support.`,
      fix,
    };
  if (!semver.subset(input, range))
    return {
      severity: "review",
      message: `${name}: range permits versions outside verified V1 support. Inspect the lockfile.`,
      fix,
    };
  return {
    severity: "info",
    message: `${name}: ${parsed ? "version" : "declared range"} meets the verified floor.${name === "@solana/web3.js" && major === 1 ? " The 1.x line reads V1 only; it cannot build or send V1." : ""}`,
    fix: "Confirm the installed version and run a real V1 fixture; static checks do not verify runtime support.",
  };
}
