import * as anchor from '@coral-xyz/anchor';
import { DriftVaults } from '../target/types/drift_vaults';
import { Program } from '@coral-xyz/anchor';
import { AdminClient, BN } from '@drift-labs/sdk';
import {
	initializeQuoteSpotMarket,
	mockUSDCMint,
	mockUserUSDCAccount,
	printTxLogs,
} from './testHelpers';
import { Keypair } from '@solana/web3.js';
import { assert } from 'chai';
import { VaultClient, getVaultAddressSync, getVaultDepositorAddressSync } from '../ts/sdk/src';
import { encodeName } from '../ts/sdk/src/name';

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
	let userUSDCAccount: Keypair;

	const vaultName = 'crisp vault';
	const vault = getVaultAddressSync(program.programId, encodeName(vaultName));

	const usdcAmount = new BN(1000 * 10 ** 6);

	before(async () => {
		usdcMint = await mockUSDCMint(provider);
		userUSDCAccount = await mockUserUSDCAccount(usdcMint, usdcAmount, provider);
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

	it('Deposit', async () => {
		const vaultAccount = await program.account.vault.fetch(vault);
		const vaultDepositor = getVaultDepositorAddressSync(
			program.programId,
			vault
		);
		const remainingAccounts = adminClient.getRemainingAccounts({
			userAccounts: [],
			writableSpotMarketIndexes: [0],
		});

		const txSig = await program.methods
			.deposit(usdcAmount)
			.accounts({
				userTokenAccount: userUSDCAccount.publicKey,
				vault,
				vaultDepositor,
				vaultTokenAccount: vaultAccount.tokenAccount,
				driftUser: vaultAccount.user,
				driftUserStats: vaultAccount.userStats,
				driftState: await adminClient.getStatePublicKey(),
				driftSpotMarketVault: adminClient.getSpotMarketAccount(0).vault,
				driftProgram: adminClient.program.programId,
			})
			.remainingAccounts(remainingAccounts)
			.rpc();

		await printTxLogs(provider.connection, txSig);
	});

	it('Withdraw', async () => {
		const vaultAccount = await program.account.vault.fetch(vault);
		const vaultDepositor = getVaultDepositorAddressSync(
			program.programId,
			vault
		);
		const remainingAccounts = adminClient.getRemainingAccounts({
			userAccounts: [],
			writableSpotMarketIndexes: [0],
		});

		const txSig = await program.methods
			.withdraw(usdcAmount)
			.accounts({
				userTokenAccount: userUSDCAccount.publicKey,
				vault,
				vaultDepositor,
				vaultTokenAccount: vaultAccount.tokenAccount,
				driftUser: vaultAccount.user,
				driftUserStats: vaultAccount.userStats,
				driftState: await adminClient.getStatePublicKey(),
				driftSpotMarketVault: adminClient.getSpotMarketAccount(0).vault,
				driftSigner: adminClient.getStateAccount().signer,
				driftProgram: adminClient.program.programId,
			})
			.remainingAccounts(remainingAccounts)
			.rpc();

		await printTxLogs(provider.connection, txSig);
	});
});
