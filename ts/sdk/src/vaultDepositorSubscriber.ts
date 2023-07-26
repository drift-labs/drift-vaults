import {
	BulkAccountLoader,
	DataAndSlot,
	NotSubscribedError,
	PublicKey,
} from '@drift-labs/sdk';
import { getVaultDepositorAddressSync } from './addresses';
import { Program } from '@coral-xyz/anchor';
import StrictEventEmitter from 'strict-event-emitter-types';
import { EventEmitter } from 'events';
import { VaultDepositor } from './types/types';
import { DriftVaults } from './types/drift_vaults';

export class VaultDepositorSubscriber {
	private program: Program<DriftVaults>;
	private _isSubscribed: boolean;
	private pubkey: PublicKey;
	private depositor?: DataAndSlot<VaultDepositor>;

	private _eventEmitter: StrictEventEmitter<EventEmitter, any>; // TODO: fix event type
	private accountLoader: BulkAccountLoader;
	private callbackId: string | null = null;
	private errorCallbackId: string | null = null;

	constructor(
		program: Program<DriftVaults>,
		vaultDepositorPubKey: PublicKey,
		accountLoader: BulkAccountLoader
	) {
		this.accountLoader = accountLoader;
		this._isSubscribed = false;
		this.pubkey = vaultDepositorPubKey;
		this.program = program;
		this._eventEmitter = new EventEmitter();
	}

	static getAddressSync(
		programId: PublicKey,
		vault: PublicKey,
		authority: PublicKey
	): PublicKey {
		return getVaultDepositorAddressSync(programId, vault, authority);
	}

	public get isSubscribed(): boolean {
		return this._isSubscribed;
	}

	public get eventEmitter(): StrictEventEmitter<EventEmitter, any> {
		return this._eventEmitter;
	}

	public async subscribe(): Promise<boolean> {
		if (this._isSubscribed) {
			return true;
		}

		try {
			await this.addToAccountLoader();

			await this.fetchIfUnloaded();
			if (this.depositor) {
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
			console.log(
				'Account for vault depositor already added to account loader'
			);
			return;
		}

		this.callbackId = await this.accountLoader.addAccount(
			this.pubkey,
			(buffer, slot) => {
				if (!buffer) return;

				if (this.depositor && this.depositor.slot > slot) {
					return;
				}

				const account =
					this.program.account.vaultDepositor.coder.accounts.decode(
						'vaultDepositor',
						buffer
					);
				this.depositor = { data: account, slot };
				this._eventEmitter.emit('vaultDepositorUpdate', account);
				this._eventEmitter.emit('update');
			}
		);

		this.errorCallbackId = this.accountLoader.addErrorCallbacks((error) => {
			this._eventEmitter.emit('error', error);
		});
	}

	async fetchIfUnloaded(): Promise<void> {
		if (this.depositor === undefined) {
			await this.fetch();
		}
	}

	async fetch(): Promise<void> {
		await this.accountLoader.load();
		const { buffer, slot } = this.accountLoader.getBufferAndSlot(this.pubkey);
		const currentSlot = this.depositor?.slot ?? 0;
		if (buffer && slot > currentSlot) {
			const account = this.program.account.vaultDepositor.coder.accounts.decode(
				'User',
				buffer
			);
			this.depositor = { data: account, slot };
		}
	}

	public async unsubscribe(): Promise<void> {
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

	public getUserAccountAndSlot(): DataAndSlot<VaultDepositor> {
		this.assertIsSubscribed();
		return this.depositor;
	}

	public updateData(vaultDepositorAcc: VaultDepositor, slot: number): void {
		if (!this.depositor || this.depositor.slot < slot) {
			this.depositor = { data: vaultDepositorAcc, slot };
			this._eventEmitter.emit('vaultDepositorUpdate', vaultDepositorAcc);
			this._eventEmitter.emit('update');
		}
	}
}
