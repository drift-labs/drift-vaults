import * as anchor from '@coral-xyz/anchor';
import { DriftVaults } from '../target/types/drift_vaults';
import { Program } from '@coral-xyz/anchor';
import { AdminClient, BN } from '@drift-labs/sdk';
import { initializeQuoteSpotMarket, mockUSDCMint } from './testHelpers';
import { Keypair } from '@solana/web3.js';
import { assert } from 'chai';
import { VaultClient } from '../ts/sdk/src';
import { getVaultAddressSync } from '../ts/sdk/src';
import { encodeName } from '../ts/sdk/lib/name';

describe('driftVaults', () => {
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
		wallet: provider.wallet,
	});

	const vaultClient = new VaultClient({
		driftClient: adminClient,
		program: program,
	});

	let usdcMint: Keypair;

	const vaultName = 'crisp vault';
	const vault = getVaultAddressSync(program.programId, encodeName(vaultName));

	before(async () => {
		usdcMint = await mockUSDCMint(provider);
		await adminClient.initialize(usdcMint.publicKey, false);
		await adminClient.subscribe();
		await initializeQuoteSpotMarket(adminClient, usdcMint.publicKey);
	});

	after(async () => {
		await adminClient.unsubscribe();
	});

	it('Initialize Vault', async () => {
		await vaultClient.initializeVault(vaultName, 0);

		await adminClient.fetchAccounts();
		assert(adminClient.getStateAccount().numberOfAuthorities.eq(new BN(1)));
		assert(adminClient.getStateAccount().numberOfSubAccounts.eq(new BN(1)));
	});

	it('Initialize Vault Depositor', async () => {
		await vaultClient.initializeVaultDepositor(vault);
	});
});
