import * as anchor from "@coral-xyz/anchor";
import { DriftVaults } from "../target/types/drift_vaults";
import {Program} from "@coral-xyz/anchor";
import {AdminClient, BN, getUserStatsAccountPublicKey} from "@drift-labs/sdk";
import {mockUSDCMint} from "./testHelpers";
import {Keypair, PublicKey} from "@solana/web3.js";
import { assert } from 'chai';

describe("drift-vaults", () => {
	// Configure the client to use the local cluster.
	const provider = anchor.AnchorProvider.local(undefined, {
		preflightCommitment: 'confirmed',
		skipPreflight: false,
		commitment: 'confirmed',
	});

	const connection = provider.connection;
	anchor.setProvider(provider);

	const program = anchor.workspace.DriftVaults as Program<DriftVaults>;
	const adminClient = new AdminClient({
		connection,
		wallet: provider.wallet
	});

	let usdcMint: Keypair;

	before(async () => {
		usdcMint = await mockUSDCMint(provider);
		await adminClient.initialize(usdcMint.publicKey, false);
		await adminClient.subscribe();
	})

	it("Is initialized!", async () => {
		const authority = PublicKey.findProgramAddressSync(
			[],
			program.programId
		)[0];

		const userStatsKey = await getUserStatsAccountPublicKey(adminClient.program.programId, authority);

		const tx = await program.methods.initialize().accounts({
			driftUserStats: userStatsKey,
			driftState: await adminClient.getStatePublicKey(),
			authority,
			payer: provider.wallet.publicKey,
			driftProgram: adminClient.program.programId,
		}).rpc();

		await adminClient.fetchAccounts();
		assert(adminClient.getStateAccount().numberOfAuthorities.eq(new BN(1)));
	});
});
