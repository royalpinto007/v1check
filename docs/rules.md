# Rules and limits

Rule snapshot: **27 October 2026**. The tool does not download rule updates.

| SDK                                | Verified stable support                |
| ---------------------------------- | -------------------------------------- |
| `@solana/kit`                      | 8.x, starting at 8.0.0                 |
| `@solana/web3.js`                  | 3.x, starting at 3.0.2                 |
| `@solana/web3.js`                  | 1.x, starting at 1.99.0, V1 reads only |
| `@solana/wallet-standard-features` | 1.x, starting at 1.5.0                 |
| `@triton-one/yellowstone-grpc`     | 6.x, starting at 6.0.0                 |

Source: [official V1 SDK matrix](https://solana.com/upgrades/larger-transaction-sizes). New major versions and prereleases need review. An exact old version or a declaration excluding supported versions is an error; a broad range permitting old versions needs review. Manifest and lockfile observations are reported separately. A declaration is never proof of what is installed.

RPC reads need numeric `maxSupportedTransactionVersion: 1` to opt into V1. The scanner recognizes named or namespace ESM imports of `Connection`, `createSolanaRpc` and `createSolanaRpcSubscriptions`, const client aliases, supported reader methods, and literal JSON-RPC 2.0 descriptors. It follows primitive const version values. Mutable options objects, computed settings and overriding spreads need review. SDK defaults are not assumed.

It also flags imported Compute Budget instruction builders for manual review: these remain valid for legacy/v0; V1 config and priority-fee units differ. See [versioned transactions](https://solana.com/docs/core/transactions/versioned-transactions) and [SIMD-0385](https://github.com/solana-foundation/solana-improvement-documents/blob/main/proposals/0385-transaction-v1.md).

### Coverage

- JavaScript/TypeScript source and nested `package.json` files; npm lockfile v1/v2/v3, Yarn classic/Berry and pnpm package sections.
- Root `.gitignore` and `.v1checkignore` are respected. Nested ignore files are not interpreted.
- Skip symlinks, dependencies, generated output, caches and non-allowlisted files, including `.env`.
- Limits: 3,000 files, 20,000 directory entries, depth 32, 1 MiB per source, 4 MiB per manifest/lockfile, 50 MiB total. Skips and parse failures make coverage partial.
- Cross-file clients, CommonJS imports, custom wrappers, webpack aliases, dependency aliases and runtime mutations are not fully resolved.
- No V1 payload decoding, RPC connectivity, wallet capability or sender correctness is verified. HTML has no scripts or external assets.

Before shipping, read a real V1 transaction using your installed SDK/RPC. For V1 sending, check explicit compute/data limits, absolute-lamport priority fees, base64 encoding for large transactions and wallet capability negotiation. Version 0 and legacy transactions are still supported on-chain.
