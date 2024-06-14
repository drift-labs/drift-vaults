import * as anchor from '@coral-xyz/anchor';
import { DriftVaults } from '../target/types/drift_vaults';
import { Program } from '@coral-xyz/anchor';
import {
	AdminClient,
	BN,
	BulkAccountLoader,
	DriftClient,
	InsuranceFundStake,
	TWO,
	UserAccount,
	ZERO,
	getInsuranceFundStakeAccountPublicKey,
} from '@drift-labs/sdk';
import {
	calculateAllPdas,
	createUserWithUSDCAccount,
	initializeQuoteSpotMarket,
	mockUSDCMint,
	mockUserUSDCAccount,
	printTxLogs,
	validateTotalUserShares,
} from './testHelpers';
import { Keypair } from '@solana/web3.js';
import { assert } from 'chai';
import {
	VaultClient,
	getTokenizedVaultAddressSync,
	getTokenizedVaultMintAddressSync,
	getVaultAddressSync,
	getVaultDepositorAddressSync,
} from '../ts/sdk/src';
import { encodeName } from '../ts/sdk/src/name';
import { WithdrawUnit } from '../ts/sdk/src/types/types';
import {
	CompetitionsClient,
	getCompetitionAddressSync,
	getCompetitorAddressSync,
} from '@drift-labs/competitions-sdk/lib';

import { getMint, getAssociatedTokenAddressSync } from '@solana/spl-token';
import { Metaplex } from '@metaplex-foundation/js';

describe('driftVaults', () => {
	// Configure the client to use the local cluster.
	const provider = anchor.AnchorProvider.local(undefined, {
		preflightCommitment: 'confirmed',
		skipPreflight: false,
		commitment: 'confirmed',
	});

	const connection = provider.connection;
	const bulkAccountLoader = new BulkAccountLoader(connection, 'confirmed', 1);
	anchor.setProvider(provider);

	const program = anchor.workspace.DriftVaults as Program<DriftVaults>;
	const adminClient = new AdminClient({
		connection,
		wallet: provider.wallet,
		accountSubscription: {
			type: 'websocket',
			resubTimeoutMs: 30_000,
		},
	});

	const metaplex = Metaplex.make(connection);
	const vaultClient = new VaultClient({
		driftClient: adminClient,
		program: program,
		metaplex: metaplex,
		cliMode: true,
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
		bulkAccountLoader.startPolling();
		await bulkAccountLoader.load();
	});

	after(async () => {
		await adminClient.unsubscribe();
		bulkAccountLoader.stopPolling();
	});

	it('Initialize Vault', async () => {
		await vaultClient.initializeVault({
			name: encodeName(vaultName),
			spotMarketIndex: 0,
			redeemPeriod: ZERO,
			maxTokens: ZERO,
			managementFee: ZERO,
			profitShare: 0,
			hurdleRate: 0,
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

		try {
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

			const vd = await program.account.vaultDepositor.fetch(vaultDepositor);
			assert(vd.totalDeposits.eq(usdcAmount));
		} catch (e) {
			console.error(e);
			assert(false);
		}
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

	it('Test initializeInsuranceFundStake', async () => {
		const spotMarket = adminClient.getSpotMarketAccount(0);
		const [driftClient, _user, _kp] = await createUserWithUSDCAccount(
			adminClient.provider,
			usdcMint,
			new anchor.Program(
				adminClient.program.idl,
				adminClient.program.programId,
				adminClient.provider
			),
			new BN(1000 * 10 ** 6),
			[],
			[0],
			[
				{
					publicKey: spotMarket.oracle,
					source: spotMarket.oracleSource,
				},
			],
			bulkAccountLoader
		);
		const vaultClient = new VaultClient({
			driftClient: driftClient,
			program: program,
		});
		const vaultName = 'if stake vault';
		const vault = getVaultAddressSync(program.programId, encodeName(vaultName));
		await vaultClient.initializeVault({
			name: encodeName(vaultName),
			spotMarketIndex: 0,
			redeemPeriod: ZERO,
			maxTokens: ZERO,
			managementFee: ZERO,
			profitShare: 0,
			hurdleRate: 0,
			permissioned: false,
			minDepositAmount: ZERO,
		});

		const testInitIFStakeAccount = async (marketIndex: number) => {
			const ifStakeTx0 = await vaultClient.initializeInsuranceFundStake(
				vault,
				marketIndex
			);
			await printTxLogs(provider.connection, ifStakeTx0);

			try {
				const ifStakeAccountPublicKey = getInsuranceFundStakeAccountPublicKey(
					driftClient.program.programId,
					vault,
					marketIndex
				);
				const ifStakeAccount =
					(await driftClient.program.account.insuranceFundStake.fetch(
						ifStakeAccountPublicKey
					)) as InsuranceFundStake;

				assert(ifStakeAccount, "Couldn't fetch IF stake account");
				assert(
					ifStakeAccount.marketIndex === marketIndex,
					'Market index is incorrect'
				);
				assert(
					ifStakeAccount.authority.equals(vault),
					'Vault is not the authority'
				);
				assert(ifStakeAccount.ifShares.eq(new BN(0)), 'Doesnt have 0 shares');
			} catch (err) {
				console.log(err);
				assert(false, "Couldn't fetch IF stake account");
			}
		};

		await testInitIFStakeAccount(0);
	});

	it('Test initializeCompetitor', async () => {
		const spotMarket = adminClient.getSpotMarketAccount(0);
		const [driftClient, _user, _kp] = await createUserWithUSDCAccount(
			adminClient.provider,
			usdcMint,
			new anchor.Program(
				adminClient.program.idl,
				adminClient.program.programId,
				adminClient.provider
			),
			new BN(1000 * 10 ** 6),
			[],
			[0],
			[
				{
					publicKey: spotMarket.oracle,
					source: spotMarket.oracleSource,
				},
			],
			bulkAccountLoader
		);
		const vaultClient = new VaultClient({
			driftClient: driftClient,
			program: program,
		});
		const vaultName = 'competition vault';
		const vault = getVaultAddressSync(program.programId, encodeName(vaultName));
		await vaultClient.initializeVault({
			name: encodeName(vaultName),
			spotMarketIndex: 0,
			redeemPeriod: ZERO,
			maxTokens: ZERO,
			managementFee: ZERO,
			profitShare: 0,
			hurdleRate: 0,
			permissioned: false,
			minDepositAmount: ZERO,
		});

		try {
			const competitionsClient = new CompetitionsClient({
				// @ts-ignore
				driftClient: driftClient as DriftClient,
			});
			const competitionName = 'sweepstakes';
			const encodedName = encodeName(competitionName);
			const competitionAddress = getCompetitionAddressSync(
				competitionsClient.program.programId,
				encodedName
			);
			const competitorAddress = getCompetitorAddressSync(
				competitionsClient.program.programId,
				competitionAddress,
				vault
			);
			const initCompTx = await competitionsClient.initializeCompetition({
				name: competitionName,
				nextRoundExpiryTs: ZERO,
				competitionExpiryTs: ZERO,
				roundDuration: ZERO,
				maxEntriesPerCompetitor: ZERO,
				minSponsorAmount: ZERO,
				maxSponsorFraction: ZERO,
				numberOfWinners: 1,
			});
			await printTxLogs(provider.connection, initCompTx);

			const initCompetitorTx = await vaultClient.initializeCompetitor(
				vault,
				competitionsClient,
				competitionName
			);
			await printTxLogs(provider.connection, initCompetitorTx);

			const competitorAccount =
				await competitionsClient.program.account.competitor.fetch(
					competitorAddress
				);
			assert(
				competitorAccount.competition.equals(competitionAddress),
				'Competition address is incorrect'
			);
			assert(
				competitorAccount.authority.equals(vault),
				'Vault is not the competitor authority'
			);
		} catch (err) {
			console.log(err);
			assert(false, 'Failed to initialize competitor');
		}
	});

	it('Initialize Tokenized Vault Depositor', async () => {
		try {
			await vaultClient.initializeTokenizedVaultDepositor({
				vault,
				tokenName: 'Tokenized Vault',
				tokenSymbol: 'TV',
				tokenUri: '',
				decimals: 6,
			});
		} catch (e) {
			console.error(e);
			assert(false);
		}

		const tokenMint = getTokenizedVaultMintAddressSync(
			program.programId,
			vault
		);
		const metadataAccount = metaplex.nfts().pdas().metadata({
			mint: tokenMint,
		});

		const mintAccount = await getMint(connection, tokenMint);
		assert(mintAccount.mintAuthority.equals(vault));
		assert(mintAccount.decimals === 6);
		assert(mintAccount.isInitialized === true);

		assert((await connection.getAccountInfo(metadataAccount)) !== null);
		const metadata = await metaplex
			.nfts()
			.findByMint({ mintAddress: tokenMint });
		assert(metadata.mint.address.equals(tokenMint));
		assert(metadata.name === 'Tokenized Vault');
		assert(metadata.symbol === 'TV');
		assert(metadata.uri === '');
	});

	it('Tokenize vault shares', async () => {
		const vaultDepositor = getVaultDepositorAddressSync(
			program.programId,
			vault,
			provider.wallet.publicKey
		);

		await vaultClient.deposit(
			vaultDepositor,
			usdcAmount,
			undefined,
			undefined,
			userUSDCAccount.publicKey
		);

		const mintAddress = getTokenizedVaultMintAddressSync(
			program.programId,
			vault
		);
		let mintAccount = await getMint(connection, mintAddress);
		assert(Number(mintAccount.supply) === 0);

		const vdBefore = await program.account.vaultDepositor.fetch(vaultDepositor);
		const vaultBefore = await program.account.vault.fetch(vault);

		assert(Number(vdBefore.vaultShares) === Number(usdcAmount));

		const txSig = await vaultClient.tokenizeShares(
			vaultDepositor,
			vdBefore.vaultShares,
			WithdrawUnit.SHARES
		);
		await printTxLogs(provider.connection, txSig);

		const vdAfter = await program.account.vaultDepositor.fetch(vaultDepositor);
		const vaultAfter = await program.account.vault.fetch(vault);
		assert(Number(vdAfter.vaultShares) === 0);

		mintAccount = await getMint(connection, mintAddress);

		// first tokenize, so tokens should equal amount of shares transferred
		assert(Number(mintAccount.supply) === Number(vdBefore.vaultShares));
		const userAta = getAssociatedTokenAddressSync(
			mintAddress,
			vdBefore.authority,
			false
		);
		const tokenAccountBalance = await connection.getTokenAccountBalance(
			userAta
		);
		assert(
			Number(tokenAccountBalance.value.amount) === Number(vdBefore.vaultShares)
		);
		assert(
			Number(tokenAccountBalance.value.amount) === Number(mintAccount.supply)
		);

		assert(vaultBefore.totalShares.eq(vaultAfter.totalShares));
		assert(vaultBefore.userShares.eq(vaultAfter.userShares));

		// check that all vd + tvd === total shares
		const allVds = await program.account.vaultDepositor.all();
		const allTvds = await program.account.tokenizedVaultDepositor.all();
		const vdSharesTotal = allVds.reduce(
			(acc, vd) => acc.add(vd.account.vaultShares),
			new BN(0)
		);
		const tvdSharesTotal = allTvds.reduce(
			(acc, vd) => acc.add(vd.account.vaultShares),
			new BN(0)
		);
		assert(tvdSharesTotal.add(vdSharesTotal).eq(vaultAfter.userShares));
	});

	it('Redeem vault tokens', async () => {
		const {
			vaultDepositor,
			tokenizedVaultDepositor,
			mintAddress,
			userVaultTokenAta,
			vaultTokenizedTokenAta,
		} = calculateAllPdas(program.programId, vault, provider.wallet.publicKey);

		await validateTotalUserShares(program, vault);

		const vdBefore = await program.account.vaultDepositor.fetch(vaultDepositor);
		const vdtBefore = await program.account.tokenizedVaultDepositor.fetch(
			tokenizedVaultDepositor
		);
		const vaultBefore = await program.account.vault.fetch(vault);
		const mintAccountBefore = await getMint(connection, mintAddress);
		const userTokenBalanceBefore = await connection.getTokenAccountBalance(
			userVaultTokenAta
		);
		const tvdTokenBalanceBefore = await connection.getTokenAccountBalance(
			vaultTokenizedTokenAta
		);

		assert(
			tvdTokenBalanceBefore.value.uiAmount === 0,
			'TokenizedVaultDepositor token account has tokens'
		);
		assert(
			userTokenBalanceBefore.value.uiAmount > 0,
			'User vault token balance is 0, redeem vault tokens test will fail'
		);
		assert(
			Number(mintAccountBefore.supply) > 0,
			'Mint supply is 0, redeem vault tokens test will fail'
		);

		const txSig = await vaultClient.redeemTokens(
			vaultDepositor,
			new BN(userTokenBalanceBefore.value.amount).div(TWO)
		);
		await printTxLogs(provider.connection, txSig);

		const vdAfter = await program.account.vaultDepositor.fetch(vaultDepositor);
		const vdtAfter = await program.account.tokenizedVaultDepositor.fetch(
			tokenizedVaultDepositor
		);
		const vaultAfter = await program.account.vault.fetch(vault);
		const mintAccountAfter = await getMint(connection, mintAddress);
		const userTokenBalanceAfter = await connection.getTokenAccountBalance(
			userVaultTokenAta
		);
		const tvdTokenBalanceAfter = await connection.getTokenAccountBalance(
			vaultTokenizedTokenAta
		);

		assert(
			tvdTokenBalanceAfter.value.uiAmount === 0,
			'TokenizedVaultDepositor token account has tokens'
		);

		const vdSharesDelta = vdAfter.vaultShares.sub(vdBefore.vaultShares);
		const vdtSharesDelta = vdtAfter.vaultShares.sub(vdtBefore.vaultShares);
		const tokenBalanceDelta = new BN(userTokenBalanceAfter.value.amount).sub(
			new BN(userTokenBalanceBefore.value.amount)
		);
		const mintSupplyDelta = new BN(String(mintAccountAfter.supply)).sub(
			new BN(String(mintAccountBefore.supply))
		);

		assert(
			vdAfter.vaultSharesBase === vdBefore.vaultSharesBase,
			'VaultDepositor shares base changed'
		);
		assert(
			vdtAfter.vaultSharesBase === vdtBefore.vaultSharesBase,
			'TokenizedVaultDepositor shares base changed'
		);

		assert(
			vdSharesDelta.neg().eq(vdtSharesDelta),
			'VaultDepositor and TokenizedVaultDepositor shares delta should be equal and opposite'
		);
		assert(
			tokenBalanceDelta.eq(mintSupplyDelta),
			'Token balance delta should equal mint supply delta'
		);

		// total shares should not have changed
		assert(
			vaultBefore.totalShares.eq(vaultAfter.totalShares),
			'Vault total shares should not have changed'
		);
		assert(
			vaultBefore.userShares.eq(vaultAfter.userShares),
			'Vault user shares should not have changed'
		);

		await validateTotalUserShares(program, vault);
	});
});
