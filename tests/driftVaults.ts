import * as anchor from '@coral-xyz/anchor';
import { DriftVaults } from '../target/types/drift_vaults';
import { Program } from '@coral-xyz/anchor';
import { AdminClient, BN, UserAccount, ZERO } from '@drift-labs/sdk';
import {
	initializeQuoteSpotMarket,
	mockUSDCMint,
	mockUserUSDCAccount,
	printTxLogs,
} from './testHelpers';
import { Keypair } from '@solana/web3.js';
import { assert } from 'chai';
import {
	VaultClient,
	getVaultAddressSync,
	getVaultDepositorAddressSync,
} from '../ts/sdk/src';
import { encodeName } from '../ts/sdk/src/name';
import { WithdrawUnit } from '../ts/sdk/src/types/types';

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
		await vaultClient.initializeVault({
			name: encodeName(vaultName),
			spotMarketIndex: 0,
			redeemPeriod: ZERO,
			maxTokens: ZERO,
			managementFee: ZERO,
			profitShare: ZERO,
			hurdleRate: ZERO,
			permissioned: false,
			minDepositAmount: ZERO,
		});

		await adminClient.fetchAccounts();
		assert(adminClient.getStateAccount().numberOfAuthorities.eq(new BN(1)));
		assert(adminClient.getStateAccount().numberOfSubAccounts.eq(new BN(1)));
	});

	it('Initialize Vault Depositor', async () => {
		await vaultClient.initializeVaultDepositor(
			vault,
			provider.wallet.publicKey
		);
	});

	it('Deposit', async () => {
		const vaultAccount = await program.account.vault.fetch(vault);
		const vaultDepositor = getVaultDepositorAddressSync(
			program.programId,
			vault,
			provider.wallet.publicKey
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
			vault,
			provider.wallet.publicKey
		);
		const remainingAccounts = adminClient.getRemainingAccounts({
			userAccounts: [],
			writableSpotMarketIndexes: [0],
		});

		const vaultDepositorAccount = await program.account.vaultDepositor.fetch(
			vaultDepositor
		);
		assert(vaultDepositorAccount.lastWithdrawRequest.value.eq(new BN(0)));
		console.log(
			'vaultDepositorAccount.vaultShares:',
			vaultDepositorAccount.vaultShares.toString()
		);
		assert(vaultDepositorAccount.vaultShares.eq(new BN(1_000_000_000)));

		// request withdraw
		console.log('request withdraw');
		const requestTxSig = await program.methods
			.requestWithdraw(usdcAmount, WithdrawUnit.TOKEN)
			.accounts({
				// userTokenAccount: userUSDCAccount.publicKey,
				vault,
				vaultDepositor,
				vaultTokenAccount: vaultAccount.tokenAccount,
				driftUser: vaultAccount.user,
				driftUserStats: vaultAccount.userStats,
				driftState: await adminClient.getStatePublicKey(),
				// driftSpotMarketVault: adminClient.getSpotMarketAccount(0).vault,
				// driftSigner: adminClient.getStateAccount().signer,
				// driftProgram: adminClient.program.programId,
				// tokenProgram: TOKEN_PROGRAM_ID,
			})
			.remainingAccounts(remainingAccounts)
			.rpc();

		await printTxLogs(provider.connection, requestTxSig);

		const vaultDepositorAccountAfter =
			await program.account.vaultDepositor.fetch(vaultDepositor);
		assert(vaultDepositorAccountAfter.vaultShares.eq(new BN(1_000_000_000)));
		console.log(
			'vaultDepositorAccountAfter.lastWithdrawRequestShares:',
			vaultDepositorAccountAfter.lastWithdrawRequest.shares.toString()
		);
		assert(
			!vaultDepositorAccountAfter.lastWithdrawRequest.shares.eq(new BN(0))
		);
		assert(!vaultDepositorAccountAfter.lastWithdrawRequest.value.eq(new BN(0)));

		// do withdraw
		console.log('do withdraw');
		try {
			const txSig = await program.methods
				.withdraw()
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
		} catch (e) {
			console.error(e);
			assert(false);
		}
	});

	it('Update Delegate', async () => {
		const vaultAccount = await program.account.vault.fetch(vault);
		const delegateKeyPair = Keypair.generate();
		const txSig = await program.methods
			.updateDelegate(delegateKeyPair.publicKey)
			.accounts({
				vault,
				driftUser: vaultAccount.user,
				driftProgram: adminClient.program.programId,
			})
			.rpc();

		const user = (await adminClient.program.account.user.fetch(
			vaultAccount.user
		)) as UserAccount;
		assert(user.delegate.equals(delegateKeyPair.publicKey));

		await printTxLogs(provider.connection, txSig);
	});

	it('Delete Vault', async () => {
		const newVaultName = "another vault";
		await vaultClient.initializeVault({
			name: encodeName(newVaultName),
			spotMarketIndex: 0,
			redeemPeriod: ZERO,
			maxTokens: ZERO,
			managementFee: ZERO,
			profitShare: ZERO,
			hurdleRate: ZERO,
			permissioned: false,
			minDepositAmount: ZERO,
		});
		const vaultAddress = getVaultAddressSync(program.programId, encodeName(newVaultName));
		console.log(`New vault address: ${vaultAddress.toBase58()}`);

		await adminClient.fetchAccounts();
		assert(adminClient.getStateAccount().numberOfAuthorities.eq(new BN(2)));
		assert(adminClient.getStateAccount().numberOfSubAccounts.eq(new BN(2)));

		console.log("deleting vault");
		await vaultClient.deleteVault(vaultAddress);

		await adminClient.fetchAccounts();
		assert(adminClient.getStateAccount().numberOfAuthorities.eq(new BN(1)));
		assert(adminClient.getStateAccount().numberOfSubAccounts.eq(new BN(1)));

		// await vaultClient.initializeVault({
		// 	name: encodeName(newVaultName),
		// 	spotMarketIndex: 0,
		// 	redeemPeriod: ZERO,
		// 	maxTokens: ZERO,
		// 	managementFee: ZERO,
		// 	profitShare: ZERO,
		// 	hurdleRate: ZERO,
		// 	permissioned: false,
		// 	minDepositAmount: ZERO,
		// });
		// await adminClient.fetchAccounts();
		// assert(adminClient.getStateAccount().numberOfAuthorities.eq(new BN(2)));
		// assert(adminClient.getStateAccount().numberOfSubAccounts.eq(new BN(2)));
	});
});
