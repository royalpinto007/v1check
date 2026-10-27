// Fictional source for offline checks. This file is parsed, never executed.
import { Connection } from '@solana/web3.js';
const rpc = new Connection('https://api.devnet.solana.com');
const signature = 'FICTIONAL_SIGNATURE';
rpc.getTransaction(signature, { maxSupportedTransactionVersion: 0 });
rpc.getBlock(42);
rpc.getBlock(43, { maxSupportedTransactionVersion: 1 });
