import {
	DriftClient,
	getUserAccountPublicKeySync,
	getUserStatsAccountPublicKey,
} from '@drift-labs/sdk';
import { Program } from '@coral-xyz/anchor';
import { DriftVaults } from './types/drift_vaults';
import { encodeName } from './name';
import { getVaultAddressSync, getVaultDepositorAddressSync } from './addresses';
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

	public async initializeVault(name: string): Promise<TransactionSignature> {
		const encodedName = encodeName(name);
		const vault = getVaultAddressSync(this.program.programId, encodedName);

		const driftState = await this.driftClient.getStatePublicKey();
		const userStatsKey = await getUserStatsAccountPublicKey(
			this.driftClient.program.programId,
			vault
		);
		const userKey = await getUserAccountPublicKeySync(
			this.driftClient.program.programId,
			vault
		);

		return await this.program.methods
			.initializeVault(encodedName)
			.accounts({
				driftUserStats: userStatsKey,
				driftUser: userKey,
				driftState,
				vault,
				driftProgram: this.driftClient.program.programId,
			})
			.rpc();
	}

	public async initializeVaultDepositor(
		vault: PublicKey
	): Promise<TransactionSignature> {
		const vaultDepositor = getVaultDepositorAddressSync(
			this.program.programId,
			vault
		);

		return await this.program.methods
			.initializeVaultDepositor()
			.accounts({
				vaultDepositor,
				vault,
			})
			.rpc();
	}
}
