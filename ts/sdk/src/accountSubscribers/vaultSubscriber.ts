import { PublicKey } from '@drift-labs/sdk';
import { getVaultAddressSync } from '../addresses';
import { Vault, VaultAccountEvents } from '../types/types';
import { encodeName } from '../name';
import { VaultProgramAccountSubscriber } from './vaultProgramAccountSubscriber';

export class VaultSubscriber extends VaultProgramAccountSubscriber<
	Vault,
	VaultAccountEvents
> {
	static getAddressSync(programId: PublicKey, vaultName: string): PublicKey {
		return getVaultAddressSync(programId, encodeName(vaultName));
	}

	async addToAccountLoader(): Promise<void> {
		if (this.callbackId) {
			console.log('Account for vault already added to account loader');
			return;
		}

		this.callbackId = await this.accountLoader.addAccount(
			this.pubkey,
			(buffer, slot) => {
				if (!buffer) return;

				if (this.account && this.account.slot > slot) {
					return;
				}

				const account = this.program.account.vault.coder.accounts.decode(
					'vault',
					buffer
				);
				this.account = { data: account, slot };
				this._eventEmitter.emit('vaultUpdate', account);
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
			const account = this.program.account.vault.coder.accounts.decode(
				'vault',
				buffer
			);
			this.account = { data: account, slot };
		}
	}

	updateData(vaultAcc: Vault, slot: number): void {
		if (!this.account || this.account.slot < slot) {
			this.account = { data: vaultAcc, slot };
			this._eventEmitter.emit('vaultUpdate', vaultAcc);
			this._eventEmitter.emit('update');
		}
	}
}
