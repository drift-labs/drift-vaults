import { Program } from '@coral-xyz/anchor';
import { BulkAccountLoader } from '@drift-labs/sdk';
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
}
