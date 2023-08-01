import { Program } from '@coral-xyz/anchor';
import { BulkAccountLoader } from '@drift-labs/sdk';
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
}
