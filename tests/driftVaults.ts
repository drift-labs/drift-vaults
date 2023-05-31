import * as anchor from "@coral-xyz/anchor";
import { DriftVaults } from "../target/types/drift_vaults";
import {Program} from "@coral-xyz/anchor";
import {AdminClient, BN, getUserAccountPublicKey, getUserStatsAccountPublicKey} from "@drift-labs/sdk";
import {mockUSDCMint} from "./testHelpers";
import {Keypair, PublicKey} from "@solana/web3.js";
import { assert } from 'chai';
import {VaultClient} from "../ts/sdk/src/vaultClient";

function encodeName(name: string): number[] {
	if (name.length > 32) {
		throw Error(`Name (${name}) longer than 32 characters`);
	}

	const buffer = Buffer.alloc(32);
	buffer.fill(name);
	buffer.fill(' ', name.length);

	return Array(...buffer);
}

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

	const vaultClient = new VaultClient({
		driftClient: adminClient,
		program: program,
	});

	let usdcMint: Keypair;

	before(async () => {
		usdcMint = await mockUSDCMint(provider);
		await adminClient.initialize(usdcMint.publicKey, false);
		await adminClient.subscribe();
	})

	it("Is initialized!", async () => {
		const name = 'crisp vault';

		await vaultClient.initializeVault(name);

		await adminClient.fetchAccounts();
		assert(adminClient.getStateAccount().numberOfAuthorities.eq(new BN(1)));
		assert(adminClient.getStateAccount().numberOfSubAccounts.eq(new BN(1)));
	});
});
