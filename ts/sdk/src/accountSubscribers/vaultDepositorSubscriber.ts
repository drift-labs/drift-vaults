import { PublicKey } from '@drift-labs/sdk';
import { getVaultDepositorAddressSync } from '../addresses';
import { VaultDepositor, VaultDepositorAccountEvents } from '../types/types';
import { VaultProgramAccountSubscriber } from './vaultProgramAccountSubscriber';

export class VaultDepositorSubscriber extends VaultProgramAccountSubscriber<
	VaultDepositor,
	VaultDepositorAccountEvents
> {
	static getAddressSync(
		programId: PublicKey,
		vault: PublicKey,
		authority: PublicKey
	): PublicKey {
		return getVaultDepositorAddressSync(programId, vault, authority);
	}

	async addToAccountLoader(): Promise<void> {
		if (this.callbackId) {
			console.log(
				'Account for vault depositor already added to account loader'
			);
			return;
		}

		this.callbackId = await this.accountLoader.addAccount(
			this.pubkey,
			(buffer, slot) => {
				if (!buffer) return;

				if (this.account && this.account.slot > slot) {
					return;
				}

				const account =
					this.program.account.vaultDepositor.coder.accounts.decode(
						'vaultDepositor',
						buffer
					);
				this.account = { data: account, slot };
				this._eventEmitter.emit('vaultDepositorUpdate', account);
				this._eventEmitter.emit('update');
			}
		);

		this.errorCallbackId = this.accountLoader.addErrorCallbacks((error) => {
			this._eventEmitter.emit('error', error);
		});
	}

	async fetch(): Promise<void> {
		await this.accountLoader.load();
		const { buffer, slot } = this.accountLoader.getBufferAndSlot(this.pubkey);
		const currentSlot = this.account?.slot ?? 0;
		if (buffer && slot > currentSlot) {
			const account = this.program.account.vaultDepositor.coder.accounts.decode(
				'vaultDepositor',
				buffer
			);
			this.account = { data: account, slot };
		}
	}

	updateData(vaultDepositorAcc: VaultDepositor, slot: number): void {
		if (!this.account || this.account.slot < slot) {
			this.account = { data: vaultDepositorAcc, slot };
			this._eventEmitter.emit('vaultDepositorUpdate', vaultDepositorAcc);
			this._eventEmitter.emit('update');
		}
	}
}
