import {
	BulkAccountLoader,
	DataAndSlot,
	NotSubscribedError,
	PublicKey,
} from '@drift-labs/sdk';
import { getVaultAddressSync } from './addresses';
import { Program } from '@coral-xyz/anchor';
import StrictEventEmitter from 'strict-event-emitter-types';
import { EventEmitter } from 'events';
import { Vault, VaultAccountEvents } from './types/types';
import { DriftVaults } from './types/drift_vaults';
import { encodeName } from './name';

export class VaultSubscriber {
	private program: Program<DriftVaults>;
	private _isSubscribed: boolean;
	private pubkey: PublicKey;
	private account?: DataAndSlot<Vault>;

	private _eventEmitter: StrictEventEmitter<EventEmitter, VaultAccountEvents>;
	private accountLoader: BulkAccountLoader;
	private callbackId: string | null = null;
	private errorCallbackId: string | null = null;

	constructor(
		program: Program<DriftVaults>,
		vaultPubKey: PublicKey,
		accountLoader: BulkAccountLoader
	) {
		this.accountLoader = accountLoader;
		this._isSubscribed = false;
		this.pubkey = vaultPubKey;
		this.program = program;
		this._eventEmitter = new EventEmitter();
	}

	static getAddressSync(programId: PublicKey, vaultName: string): PublicKey {
		return getVaultAddressSync(programId, encodeName(vaultName));
	}

	get isSubscribed(): boolean {
		return this._isSubscribed;
	}

	get eventEmitter(): StrictEventEmitter<EventEmitter, any> {
		return this._eventEmitter;
	}

	async subscribe(): Promise<boolean> {
		if (this._isSubscribed) {
			return true;
		}

		try {
			await this.addToAccountLoader();

			await this.fetchIfUnloaded();
			if (this.account) {
				this._eventEmitter.emit('update');
			}

			this._isSubscribed = true;
			return true;
		} catch (err) {
			console.error(err);
			this._isSubscribed = false;
			return false;
		}
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

	async fetchIfUnloaded(): Promise<void> {
		if (this.account === undefined) {
			await this.fetch();
		}
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

	async unsubscribe(): Promise<void> {
		if (!this._isSubscribed) {
			return;
		}

		this.accountLoader.removeAccount(this.pubkey, this.callbackId);
		this.callbackId = undefined;

		this.accountLoader.removeErrorCallbacks(this.errorCallbackId);
		this.errorCallbackId = undefined;

		this._isSubscribed = false;
	}

	assertIsSubscribed(): void {
		if (!this._isSubscribed) {
			throw new NotSubscribedError(
				'You must call `subscribe` before using this function'
			);
		}
	}

	getUserAccountAndSlot(): DataAndSlot<Vault> {
		this.assertIsSubscribed();
		return this.account;
	}

	updateData(vaultAcc: Vault, slot: number): void {
		if (!this.account || this.account.slot < slot) {
			this.account = { data: vaultAcc, slot };
			this._eventEmitter.emit('vaultUpdate', vaultAcc);
			this._eventEmitter.emit('update');
		}
	}
}
