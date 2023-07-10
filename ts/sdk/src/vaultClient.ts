import {
	BN,
	DriftClient,
	getUserAccountPublicKeySync,
	getUserStatsAccountPublicKey,
} from '@drift-labs/sdk';
import { Program } from '@coral-xyz/anchor';
import { DriftVaults } from './types/drift_vaults';
import {
	getTokenVaultAddressSync,
	getVaultAddressSync,
	getVaultDepositorAddressSync,
} from './addresses';
import { PublicKey, TransactionSignature } from '@solana/web3.js';

export class VaultClient {
	driftClient: DriftClient;
	program: Program<DriftVaults>;

	constructor({
		driftClient,
		program,
	}: {
		driftClient: DriftClient;
		program: Program<DriftVaults>;
	}) {
		this.driftClient = driftClient;
		this.program = program;
	}

	public async initializeVault(params: {
		name: number[];
		spotMarketIndex: number;
		redeemPeriod: BN;
		maxTokens: BN;
		managementFee: BN;
		profitShare: number;
		hurdleRate: number;
		permissioned: boolean;
	}): Promise<TransactionSignature> {
		const vault = getVaultAddressSync(this.program.programId, params.name);
		const tokenAccount = getTokenVaultAddressSync(
			this.program.programId,
			vault
		);

		const driftState = await this.driftClient.getStatePublicKey();
		const driftSpotMarket = this.driftClient.getSpotMarketAccount(
			params.spotMarketIndex
		);

		const userStatsKey = await getUserStatsAccountPublicKey(
			this.driftClient.program.programId,
			vault
		);
		const userKey = await getUserAccountPublicKeySync(
			this.driftClient.program.programId,
			vault
		);

		return await this.program.methods
			.initializeVault(params)
			.accounts({
				driftSpotMarket: driftSpotMarket.pubkey,
				driftSpotMarketMint: driftSpotMarket.mint,
				driftUserStats: userStatsKey,
				driftUser: userKey,
				driftState,
				vault,
				tokenAccount,
				driftProgram: this.driftClient.program.programId,
			})
			.rpc();
	}

	public async initializeVaultDepositor(
		vault: PublicKey,
		authority?: PublicKey
	): Promise<TransactionSignature> {
		const vaultDepositor = getVaultDepositorAddressSync(
			this.program.programId,
			vault,
			this.driftClient.wallet.publicKey
		);

		return await this.program.methods
			.initializeVaultDepositor()
			.accounts({
				vaultDepositor,
				vault,
				authority: authority || this.driftClient.wallet.publicKey,
			})
			.rpc();
	}
}
