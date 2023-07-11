import { PublicKey } from '@solana/web3.js';

export const VAULT_PROGRAM_ID = new PublicKey(
	'VAULtLeTwwUxpwAw98E6XmgaDeQucKgV5UaiAuQ655D'
);

export class WithdrawUnit {
	static readonly SHARES = { shares: {} };
	static readonly TOKEN = { token: {} };
}
