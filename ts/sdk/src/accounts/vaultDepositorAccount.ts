import { BN, Program } from '@coral-xyz/anchor';
import { BulkAccountLoader, PERCENTAGE_PRECISION, ZERO } from '@drift-labs/sdk';
import { PublicKey } from '@solana/web3.js';
import { DriftVaults } from '../types/drift_vaults';
import { VaultDepositor, VaultDepositorAccountEvents } from '../types/types';
import { PollingVaultDepositorSubscriber } from '../accountSubscribers';
import { VaultsProgramAccount } from './vaultsProgramAccount';
import { getVaultDepositorAddressSync } from '../addresses';

export class VaultDepositorAccount extends VaultsProgramAccount<
	VaultDepositor,
	VaultDepositorAccountEvents
> {
	constructor(
		program: Program<DriftVaults>,
		vaultDepositorPubkey: PublicKey,
		accountLoader: BulkAccountLoader,
		accountSubscriptionType: 'polling' | 'websocket' = 'polling'
	) {
		super();

		if (accountSubscriptionType === 'polling') {
			this.accountSubscriber = new PollingVaultDepositorSubscriber(
				program,
				vaultDepositorPubkey,
				accountLoader
			);
		} else {
			throw new Error('Websocket subscription not yet implemented');
		}
	}

	static getAddressSync(
		programId: PublicKey,
		vault: PublicKey,
		authority: PublicKey
	): PublicKey {
		return getVaultDepositorAddressSync(programId, vault, authority);
	}

	/**
	 * Calculates the percentage of a depositor's funds that will be paid as profit share fees.
	 *
	 * @param vaultProfitShare Vault's profit share fee
	 * @param depositorEquity Vault depositor's net deposit value
	 */
	calcProfitShareFeesProportion(vaultProfitShare: BN, depositorEquity: BN): BN {
		const accountData = this.accountSubscriber.getAccountAndSlot().data;

		// highest level in value the depositor's equity has reached that a profit share fee has been paid on
		const highWaterMark = accountData.cumulativeProfitShareAmount;

		const profit = depositorEquity
			.sub(accountData.netDeposits)
			.sub(accountData.cumulativeProfitShareAmount);

		if (profit.lte(highWaterMark)) {
			return ZERO;
		}

		const profitShareAmount = profit
			.sub(highWaterMark)
			.mul(vaultProfitShare)
			.div(PERCENTAGE_PRECISION);
		const profitShareProportion = profitShareAmount
			.mul(PERCENTAGE_PRECISION)
			.div(depositorEquity);

		return profitShareProportion;
	}
}
