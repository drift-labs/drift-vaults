import { BN, DataAndSlot, Event } from '@drift-labs/sdk';
import { PublicKey } from '@solana/web3.js';
import { EventEmitter } from 'events';
import StrictEventEmitter from 'strict-event-emitter-types';

export const VAULT_PROGRAM_ID = new PublicKey(
	'vAuLTsyrvSfZRuRB3XgvkPwNGgYSs9YRYymVebLKoxR'
);

export class WithdrawUnit {
	static readonly SHARES = { shares: {} };
	static readonly TOKEN = { token: {} };
	static readonly SHARES_PERCENT = { sharesPercent: {} };
}

export type WithdrawRequest = {
	shares: BN;
	value: BN;
	ts: BN;
};

// Vault program accounts

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
	minDepositAmount: BN;
	profitShare: number;
	hurdleRate: number;
	spotMarketIndex: number;
	bump: number;
	permissioned: boolean;
	lastManagerWithdrawRequest: WithdrawRequest;
};

export type VaultDepositor = {
	vault: PublicKey;
	pubkey: PublicKey;
	authority: PublicKey;
	vaultShares: BN;
	// lastWithdrawRequestShares: BN;
	// lastWithdrawRequestValue: BN;
	// lastWithdrawRequestTs: BN;
	lastWithdrawRequest: WithdrawRequest;
	lastValidTs: BN;
	netDeposits: BN;
	totalDeposits: BN;
	totalWithdraws: BN;
	cumulativeProfitShareAmount: BN;
	vaultSharesBase: number;
	profitShareFeePaid: BN;
	padding: number[];
};

export type VaultsProgramAccountBaseEvents = {
	update: void;
	error: (e: Error) => void;
};

export type VaultDepositorAccountEvents = {
	vaultDepositorUpdate: (payload: VaultDepositor) => void;
} & VaultsProgramAccountBaseEvents;

export type VaultAccountEvents = {
	vaultUpdate: (payload: Vault) => void;
} & VaultsProgramAccountBaseEvents;

export interface VaultsProgramAccountSubscriber<
	Account,
	AccountEvents extends VaultsProgramAccountBaseEvents
> {
	eventEmitter: StrictEventEmitter<EventEmitter, AccountEvents>;
	isSubscribed: boolean;

	subscribe(): Promise<boolean>;
	fetch(): Promise<void>;
	updateData(account: Account, slot: number): void;
	unsubscribe(): Promise<void>;
	getAccountAndSlot(): DataAndSlot<Account>;
}

export type VaultAccountSubscriber = VaultsProgramAccountSubscriber<
	Vault,
	VaultAccountEvents
>;

export type VaultDepositorAccountSubscriber = VaultsProgramAccountSubscriber<
	VaultDepositor,
	VaultDepositorAccountEvents
>;

// Logs/Records

export class VaultDepositorAction {
	static readonly DEPOSIT = { deposit: {} };
	static readonly WITHDRAW = { withdraw: {} };
	static readonly WITHDRAW_REQUEST = { withdrawRequest: {} };
	static readonly CANCEL_WITHDRAW_REQUEST = { cancelWithdrawRequest: {} };
	static readonly FEE_PAYMENT = { feePayment: {} };
}

export type VaultDepositorRecord = {
	ts: BN;

	vault: PublicKey;
	depositorAuthority: PublicKey;
	action: VaultDepositorAction;
	amount: BN;

	spotMarketIndex: number;
	vaultSharesBefore: BN;
	vaultSharesAfter: BN;
	vaultEquityBefore: BN;

	userVaultSharesBefore: BN;
	totalVaultSharesBefore: BN;

	userVaultSharesAfter: BN;
	totalVaultSharesAfter: BN;

	profitShare: BN;
	managementFee: BN;
	managementFeeShares: BN;
};

export type VaultsEventMap = {
	VaultDepositorRecord: Event<VaultDepositorRecord>;
};

export type EventType = keyof VaultsEventMap;
export type WrappedEvent<Type extends EventType> = VaultsEventMap[Type] & {
	eventType: Type;
};
export type WrappedEvents = WrappedEvent<EventType>[];
