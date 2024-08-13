import * as anchor from '@coral-xyz/anchor';
import { DriftVaults } from '../target/types/drift_vaults';
import { Program } from '@coral-xyz/anchor';
import {
	AdminClient,
	BASE_PRECISION,
	BN,
	BulkAccountLoader,
	DRIFT_PROGRAM_ID,
	DriftClient,
	InsuranceFundStake,
	OracleSource,
	OrderType,
	PERCENTAGE_PRECISION,
	PRICE_PRECISION,
	PositionDirection,
	TEN,
	TWO,
	TestClient,
	UserAccount,
	ZERO,
	getInsuranceFundStakeAccountPublicKey,
	getTokenAmount,
	getUserAccountPublicKeySync,
	getUserStatsAccountPublicKey,
	isVariant,
} from '@drift-labs/sdk';
import {
	calculateAllPdas,
	createUserWithUSDCAccount,
	getTokenAmountAsBN,
	initializeQuoteSpotMarket,
	initializeSolSpotMarket,
	initializeSolSpotMarketMaker,
	mockOracle,
	mockUSDCMint,
	mockUserUSDCAccount,
	printTxLogs,
	setFeedPrice,
	validateTotalUserShares,
} from './testHelpers';
import { Keypair, PublicKey } from '@solana/web3.js';
import { assert } from 'chai';
import {
	VaultClient,
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

import { getMint } from '@solana/spl-token';
import { Metaplex } from '@metaplex-foundation/js';
import { Test } from 'mocha';

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
	let solOracle: PublicKey;

	const vaultName = 'crisp vault';
	const vault = getVaultAddressSync(program.programId, encodeName(vaultName));

	const usdcAmount = new BN(1000 * 10 ** 6);

	before(async () => {
		usdcMint = await mockUSDCMint(provider);
		userUSDCAccount = await mockUserUSDCAccount(usdcMint, usdcAmount, provider);
		solOracle = await mockOracle(100);
		await adminClient.initialize(usdcMint.publicKey, false);
		await adminClient.subscribe();
		await initializeQuoteSpotMarket(adminClient, usdcMint.publicKey);
		await initializeSolSpotMarket(adminClient, solOracle);
		await adminClient.updateSpotMarketOrdersEnabled(0, true);
		await adminClient.updateSpotMarketOrdersEnabled(1, true);
	});

	after(async () => {
		await adminClient.unsubscribe();
		bulkAccountLoader.stopPolling();
		await vaultClient.unsubscribe();
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
		await driftClient.unsubscribe();
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

		await driftClient.unsubscribe();
	});

	it('Initialize TokenizedVaultDepositor', async () => {
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

	it('Initialize another TokenizedVaultDepositor', async () => {
		const { tokenizedVaultDepositor } = calculateAllPdas(
			program.programId,
			vault,
			provider.wallet.publicKey
		);
		const tvdAccount = await connection.getAccountInfo(tokenizedVaultDepositor);
		assert(tvdAccount !== null, 'TokenizedVaultDepositor account should exist');
		try {
			const initTx = await vaultClient.initializeTokenizedVaultDepositor({
				vault,
				tokenName: 'Tokenized Vault',
				tokenSymbol: 'TV',
				tokenUri: '',
				decimals: 6,
			});
			await printTxLogs(provider.connection, initTx);
		} catch (e) {
			return;
		}
		assert(
			false,
			'Should not have been able to initialize a second TokenizedVaultDepositor'
		);
	});

	it('Tokenize vault shares', async () => {
		const {
			vaultDepositor,
			tokenizedVaultDepositor,
			mintAddress,
			userVaultTokenAta,
			vaultTokenizedTokenAta,
		} = calculateAllPdas(program.programId, vault, provider.wallet.publicKey);

		await vaultClient.deposit(
			vaultDepositor,
			usdcAmount,
			undefined,
			undefined,
			userUSDCAccount.publicKey
		);

		await validateTotalUserShares(program, vault);

		const vdBefore = await program.account.vaultDepositor.fetch(vaultDepositor);
		const vdtBefore = await program.account.tokenizedVaultDepositor.fetch(
			tokenizedVaultDepositor
		);
		const vaultBefore = await program.account.vault.fetch(vault);
		const mintAccountBefore = await getMint(connection, mintAddress);
		const tvdTokenBalanceBefore = await connection.getTokenAccountBalance(
			vaultTokenizedTokenAta
		);

		assert(
			(await connection.getAccountInfo(userVaultTokenAta)) === null,
			'User vault token account should not exist'
		);
		assert(
			tvdTokenBalanceBefore.value.uiAmount === 0,
			'TokenizedVaultDepositor token account has tokens'
		);
		assert(Number(mintAccountBefore.supply) === 0, 'Mint supply !== 0');

		assert(
			Number(vdBefore.vaultShares) === Number(usdcAmount),
			`VaultDepositor has no shares`
		);

		try {
			const txSig = await vaultClient.tokenizeShares(
				vaultDepositor,
				vdBefore.vaultShares,
				WithdrawUnit.SHARES
			);
			await printTxLogs(provider.connection, txSig);
		} catch (e) {
			console.error(e);
			assert(false, 'tokenizeShares threw');
		}

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
			ZERO
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

		try {
			const txSig = await vaultClient.redeemTokens(
				vaultDepositor,
				new BN(userTokenBalanceBefore.value.amount).div(TWO)
			);
			await printTxLogs(provider.connection, txSig);
		} catch (e) {
			console.error(e);
			assert(false, 'redeemTokens threw');
		}

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

	/**
	 * Initializes a new vault (with TokenizedVaultDepositor) and 10% profit share, SOL spot market maker, and a non-manager depositor.
	 *
	 * Vault buys SOL spot with 99% of USDC deposits, and then the price changes from solStartPrice to solEndPrice.
	 * Depositor tokenizes shares and redeems after manager buys SOL and price changes.
	 */
	async function testRedeemVaultTokensWithProfitShare(
		solStartPrice: number,
		solEndPrice: number,
		profitable: boolean
	) {
		console.log(`Initializing SOL price to ${solStartPrice}`);
		await setFeedPrice(anchor.workspace.Pyth, solStartPrice, solOracle);

		const usdcDepositAmount = new BN(10000 * 10 ** 6);
		const usdcSpotMarket = adminClient.getSpotMarketAccount(0);
		const solSpotMarket = adminClient.getSpotMarketAccount(1);
		const [driftClient, usdcAccount, kp] = await createUserWithUSDCAccount(
			provider,
			usdcMint,
			new anchor.Program(
				adminClient.program.idl,
				adminClient.program.programId,
				provider
			),
			usdcDepositAmount,
			[],
			[0, 1],
			[
				{
					publicKey: solSpotMarket.oracle,
					source: solSpotMarket.oracleSource,
				},
			],
			bulkAccountLoader
		);
		const [mmDriftClient] = await initializeSolSpotMarketMaker(
			provider,
			usdcMint,
			new anchor.Program(
				adminClient.program.idl,
				adminClient.program.programId,
				provider
			),
			[
				{
					publicKey: solOracle,
					source: OracleSource.PYTH,
				},
			],
			undefined,
			undefined,
			bulkAccountLoader
		);

		const managerVaultClient = new VaultClient({
			// @ts-ignore
			driftClient: adminClient,
			program: program,
			metaplex: metaplex,
			cliMode: true,
		});
		const depositorVaultClient = new VaultClient({
			// @ts-ignore
			driftClient: driftClient,
			program: new anchor.Program(
				program.idl,
				program.programId,
				new anchor.AnchorProvider(provider.connection, new anchor.Wallet(kp), {
					preflightCommitment: 'confirmed',
					skipPreflight: false,
					commitment: 'confirmed',
				})
			),
			metaplex: metaplex,
			cliMode: true,
		});

		const vaultName = `vault (${solStartPrice} -> ${solEndPrice})`;
		const vault = getVaultAddressSync(program.programId, encodeName(vaultName));

		await managerVaultClient.initializeVault({
			name: encodeName(vaultName),
			spotMarketIndex: 0,
			redeemPeriod: ZERO,
			maxTokens: ZERO,
			managementFee: PERCENTAGE_PRECISION.div(TEN),
			profitShare: PERCENTAGE_PRECISION.toNumber() / 10, // 10%
			hurdleRate: 0,
			permissioned: false,
			minDepositAmount: ZERO,
		});
		await managerVaultClient.updateDelegate(vault, provider.wallet.publicKey);
		await managerVaultClient.updateMarginTradingEnabled(vault, true);

		const { vaultDepositor, tokenizedVaultDepositor, userVaultTokenAta } =
			calculateAllPdas(program.programId, vault, driftClient.wallet.publicKey);

		await managerVaultClient.initializeTokenizedVaultDepositor({
			vault,
			tokenName: 'Tokenized Vault 2',
			tokenSymbol: 'TV2',
			tokenUri: '',
			decimals: 6,
		});

		try {
			const _tx1 = await depositorVaultClient.initializeVaultDepositor(
				vault,
				driftClient.wallet.publicKey
			);
			// await printTxLogs(provider.connection, _tx1);

			const _tx2 = await depositorVaultClient.deposit(
				vaultDepositor,
				usdcDepositAmount.div(TWO),
				undefined,
				undefined,
				usdcAccount
			);
			// await printTxLogs(provider.connection, _tx2);
		} catch (e) {
			console.error(e);
			throw e;
		}
		await validateTotalUserShares(program, vault);

		const vdBefore = await program.account.vaultDepositor.fetch(vaultDepositor);
		const vdtBefore = await program.account.tokenizedVaultDepositor.fetch(
			tokenizedVaultDepositor
		);
		await depositorVaultClient.tokenizeShares(
			vaultDepositor,
			vdBefore.vaultShares,
			WithdrawUnit.SHARES
		);

		const vdAfter = await program.account.vaultDepositor.fetch(vaultDepositor);
		const vdtAfter = await program.account.tokenizedVaultDepositor.fetch(
			tokenizedVaultDepositor
		);

		const userTokenBalance = await connection.getTokenAccountBalance(
			userVaultTokenAta
		);

		console.log(`User token balance: ${userTokenBalance.value.uiAmountString}`);
		console.log(
			`VaultDepositor shares: ${vdBefore.vaultShares.toString()} -> ${vdAfter.vaultShares.toString()}`
		);
		console.log(
			`TokenizedVaultDepositor shares: ${vdtBefore.vaultShares.toString()} -> ${vdtAfter.vaultShares.toString()}`
		);

		const vaultEquity =
			await depositorVaultClient.calculateVaultEquityInDepositAsset({
				address: vault,
			});
		console.log(
			`Vault equity (${vault.toString()}): ${vaultEquity.toString()}`
		);

		const delegateDriftClient = new DriftClient({
			connection: driftClient.connection,
			wallet: provider.wallet,
			opts: {
				commitment: 'confirmed',
			},
			perpMarketIndexes: [],
			spotMarketIndexes: [0, 1],
			oracleInfos: [
				{
					publicKey: solOracle,
					source: OracleSource.PYTH,
				},
			],
			accountSubscription: {
				type: 'websocket',
			},
			authority: vault,
			activeSubAccountId: 0,
			subAccountIds: [0],
		});

		await delegateDriftClient.subscribe();

		const user = delegateDriftClient.getUser(0, vault);
		const s00 = user.getSpotPosition(0);
		const vaultUsdcBalance = getTokenAmount(
			s00.scaledBalance,
			usdcSpotMarket,
			s00.balanceType
		)
			.mul(new BN(99))
			.div(new BN(100));

		const mmUser = mmDriftClient.getUser();
		const mmOffer = mmUser
			.getOpenOrders()
			.find((o) => o.marketIndex === 1 && isVariant(o.direction, 'short'));
		if (!mmOffer) {
			throw new Error('mmOffer not found');
		}

		try {
			const tx = await delegateDriftClient.placeAndTakeSpotOrder(
				{
					orderType: OrderType.LIMIT,
					marketIndex: 1,
					baseAssetAmount: vaultUsdcBalance
						.mul(BASE_PRECISION)
						.div(mmOffer.price),
					price: mmOffer.price,
					direction: PositionDirection.LONG,
					immediateOrCancel: true,
					auctionDuration: 0,
				},
				undefined,
				{
					maker: mmUser.getUserAccountPublicKey(),
					makerStats: getUserStatsAccountPublicKey(
						new PublicKey(DRIFT_PROGRAM_ID),
						mmDriftClient.authority
					),
					makerUserAccount: mmUser.getUserAccount(),
					order: mmOffer,
				}
			);
			// await printTxLogs(provider.connection, tx, true, mmDriftClient.program);
			await printTxLogs(provider.connection, tx);
		} catch (e) {
			console.error(e);
			throw e;
		}

		await delegateDriftClient.fetchAccounts();
		await user.fetchAccounts();

		console.log(`Updating price to ${solEndPrice}`);
		await setFeedPrice(anchor.workspace.Pyth, solEndPrice, solOracle);
		await driftClient.fetchAccounts();

		const solPrice1 = delegateDriftClient.getOracleDataForSpotMarket(1).price;
		const vaultEquity2 =
			await depositorVaultClient.calculateVaultEquityInDepositAsset({
				address: vault,
			});
		console.log(
			`Vault equity (solprice: ${solPrice1.toString()}): ${vaultEquity2.toString()} (${
				(vaultEquity2.toNumber() / vaultEquity.toNumber() - 1) * 100
			}% return)`
		);

		const vdBefore1 = await program.account.vaultDepositor.fetch(
			vaultDepositor
		);
		const vdtBefore1 = await program.account.tokenizedVaultDepositor.fetch(
			tokenizedVaultDepositor
		);

		const tx3 = await depositorVaultClient.redeemTokens(
			vaultDepositor,
			new BN(userTokenBalance.value.amount)
		);
		await printTxLogs(provider.connection, tx3);

		const vdAfter1 = await program.account.vaultDepositor.fetch(vaultDepositor);
		const vdtAfter1 = await program.account.tokenizedVaultDepositor.fetch(
			tokenizedVaultDepositor
		);

		const userTokenBalance1 = await connection.getTokenAccountBalance(
			userVaultTokenAta
		);

		console.log('Shares after redeeming tokens:');
		console.log(
			`User token balance: ${userTokenBalance1.value.uiAmountString}`
		);
		console.log(
			`VaultDepositor shares: ${vdBefore1.vaultShares.toString()} -> ${vdAfter1.vaultShares.toString()}`
		);
		console.log(
			`TokenizedVaultDepositor shares: ${vdtBefore1.vaultShares.toString()} -> ${vdtAfter1.vaultShares.toString()}`
		);

		assert(
			userTokenBalance1.value.uiAmountString === '0',
			'User token balance should be 0'
		);
		assert(
			vdtAfter1.vaultShares.eq(ZERO),
			'TokenizedVaultDepositor shares should be 0'
		);

		if (profitable) {
			assert(
				vdAfter1.vaultShares.lt(vdBefore.vaultShares),
				'VaultDepositor shares should decrease due to profit share'
			);
		} else {
			assert(
				vdAfter1.vaultShares.eq(vdBefore.vaultShares),
				'VaultDepositor shares should stay same due to no profit share'
			);
		}

		await validateTotalUserShares(program, vault);

		await mmDriftClient.unsubscribe();
		await driftClient.unsubscribe();
		await delegateDriftClient.unsubscribe();
		await managerVaultClient.unsubscribe();
		await depositorVaultClient.unsubscribe();
	}

	it('Redeem vault tokens with profit share, profitable', async () => {
		// 10% gain
		await testRedeemVaultTokensWithProfitShare(100, 110, true);
	});

	it('Redeem vault tokens with profit share, not profitable', async () => {
		// 10% loss
		await testRedeemVaultTokensWithProfitShare(100, 90, false);
	});
});
