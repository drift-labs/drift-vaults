import { BN } from '@drift-labs/sdk';
import { PublicKey } from '@solana/web3.js';

export const VAULT_PROGRAM_ID = new PublicKey(
	'VAULtLeTwwUxpwAw98E6XmgaDeQucKgV5UaiAuQ655D'
);

export class WithdrawUnit {
	static readonly SHARES = { shares: {} };
	static readonly TOKEN = { token: {} };
}

export type Vault = {
	name: number[];
	pubkey: PublicKey;
	manager: PublicKey;
	tokenAccount: PublicKey;
	userStats: PublicKey;
	user: PublicKey;
	delegate: PublicKey;
	liquidationDelegate: PublicKey;
	userShares: BN;
	totalShares: BN;
	lastFeeUpdateTs: BN;
	liquidationStartTs: BN;
	redeemPeriod: BN;
	totalWithdrawRequested: BN;
	maxTokens: BN;
	sharesBase: number;
	managementFee: BN;
	initTs: BN;
	netDeposits: BN;
	managerNetDeposits: BN;
	totalDeposits: BN;
	totalWithdraws: BN;
	managerTotalDeposits: BN;
	managerTotalWithdraws: BN;
	managerTotalFee: BN;
	managerTotalProfitShare: BN;
	minimumDeposit: BN;
	profitShare: number;
	hurdleRate: number;
	spotMarketIndex: number;
	bump: number;
	permissioned: boolean;
};

export type VaultDepositor = {
	vault: PublicKey;
	pubkey: PublicKey;
	authority: PublicKey;
	vaultShares: BN;
	lastWithdrawRequestShares: BN;
	lastWithdrawRequestValue: BN;
	lastWithdrawRequestTs: BN;
	lastValidTs: BN;
	netDeposits: BN;
	totalDeposits: BN;
	totalWithdraws: BN;
	cumulativeProfitShareAmount: BN;
	vaultSharesBase: number;
	padding: number[];
};
