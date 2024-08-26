import { Program } from '@coral-xyz/anchor';
import {
	BulkAccountLoader,
	ONE,
	ONE_YEAR,
	PERCENTAGE_PRECISION,
	ZERO,
	BN,
} from '@drift-labs/sdk';
import { PublicKey } from '@solana/web3.js';
import { DriftVaults } from '../types/drift_vaults';
import { Vault, VaultAccountEvents } from '../types/types';
import { PollingVaultSubscriber } from '../accountSubscribers';
import { VaultsProgramAccount } from './vaultsProgramAccount';
import { getVaultAddressSync } from '../addresses';
import { encodeName } from '../name';

export class VaultAccount extends VaultsProgramAccount<
	Vault,
	VaultAccountEvents
> {
	constructor(
		program: Program<DriftVaults>,
		vaultPubkey: PublicKey,
		accountLoader: BulkAccountLoader,
		accountSubscriptionType: 'polling' | 'websocket' = 'polling'
	) {
		super();

		if (accountSubscriptionType === 'polling') {
			this.accountSubscriber = new PollingVaultSubscriber(
				program,
				vaultPubkey,
				accountLoader
			);
		} else {
			throw new Error('Websocket subscription not yet implemented');
		}
	}

	static getAddressSync(programId: PublicKey, vaultName: string): PublicKey {
		return getVaultAddressSync(programId, encodeName(vaultName));
	}

	calcSharesAfterManagementFee(vaultEquity: BN): {
		totalShares: BN;
		managementFeeShares: BN;
	} {
		const accountData = this.accountSubscriber.getAccountAndSlot().data;

		const depositorsEquity = accountData.userShares
			.mul(vaultEquity)
			.div(accountData.totalShares);

		if (accountData.managementFee.eq(ZERO) || depositorsEquity.lte(ZERO)) {
			return {
				totalShares: accountData.totalShares,
				managementFeeShares: ZERO,
			};
		}

		const now = new BN(Date.now() / 1000);
		const sinceLast = now.sub(accountData.lastFeeUpdateTs);

		let managementFeeAmount = depositorsEquity
			.mul(accountData.managementFee)
			.div(PERCENTAGE_PRECISION)
			.mul(sinceLast)
			.div(ONE_YEAR);
		managementFeeAmount = BN.min(
			managementFeeAmount,
			depositorsEquity.sub(ONE)
		);

		const newTotalSharesFactor = depositorsEquity
			.mul(PERCENTAGE_PRECISION)
			.div(depositorsEquity.sub(managementFeeAmount));
		let newTotalShares = accountData.totalShares
			.mul(newTotalSharesFactor)
			.div(PERCENTAGE_PRECISION);
		newTotalShares = BN.max(newTotalShares, accountData.userShares);

		const managementFeeShares = newTotalShares.sub(accountData.totalShares);

		return { totalShares: newTotalShares, managementFeeShares };
	}
}
