import * as anchor from '@coral-xyz/anchor';
import { Program } from '@coral-xyz/anchor';
import {
	AdminClient,
	BN,
	BulkAccountLoader,
	ZERO,
	PRICE_PRECISION,
	User,
	OracleSource,
	PublicKey,
	getLimitOrderParams,
	PostOnlyParams,
	PositionDirection,
	getUserAccountPublicKey,
	UserAccount,
	QUOTE_PRECISION,
	getOrderParams,
	MarketType,
	PEG_PRECISION,
	BASE_PRECISION,
	calculatePositionPNL,
	getInsuranceFundStakeAccountPublicKey,
	InsuranceFundStake,
	DriftClient,
} from '@drift-labs/sdk';
import {
	bootstrapSignerClientAndUser,
	createUserWithUSDCAccount,
	initializeQuoteSpotMarket,
	mockOracle,
	mockUSDCMint,
	printTxLogs,
	setFeedPrice,
} from './testHelpers';
import { ConfirmOptions, Keypair, SystemProgram } from '@solana/web3.js';
import { assert } from 'chai';
import {
	VaultClient,
	getVaultAddressSync,
	getVaultDepositorAddressSync,
	encodeName,
	DriftVaults,
	VaultProtocolParams,
	getVaultProtocolAddressSync,
	WithdrawUnit,
} from '../ts/sdk';
import {
	CompetitionsClient,
	getCompetitionAddressSync,
	getCompetitorAddressSync,
} from '@drift-labs/competitions-sdk';

describe('driftVaults', () => {
	const opts: ConfirmOptions = {
		preflightCommitment: 'confirmed',
		skipPreflight: false,
		commitment: 'confirmed',
	};

	// Configure the client to use the local cluster.
	const provider = anchor.AnchorProvider.local(undefined, opts);
	anchor.setProvider(provider);
	const connection = provider.connection;
	const program = anchor.workspace.DriftVaults as Program<DriftVaults>;

	const bulkAccountLoader = new BulkAccountLoader(connection, 'confirmed', 1);

	let adminClient: AdminClient;

	let manager: Keypair;
	let managerClient: VaultClient;
	let managerUser: User;

	let fillerClient: VaultClient;
	let fillerUser: User;

	let vd: Keypair;
	let vdClient: VaultClient;
	let vdUser: User;
	let vdUserUSDCAccount: Keypair;

	let vd2: Keypair;
	let vd2Client: VaultClient;
	let vd2UserUSDCAccount: Keypair;
	let _vd2User: User;

	let delegate: Keypair;
	let delegateClient: VaultClient;
	let _delegateUser: User;

	let protocol: Keypair;
	let protocolClient: VaultClient;
	let protocolVdUserUSDCAccount: Keypair;
	let _protocolUser: User;

	// ammInvariant == k == x * y
	// const mantissaSqrtScale = new BN(Math.sqrt(PRICE_PRECISION.toNumber()));
	const mantissaSqrtScale = new BN(100_000);
	const ammInitialQuoteAssetReserve = new BN(5 * 10 ** 13).mul(
		mantissaSqrtScale
	);
	const ammInitialBaseAssetReserve = new BN(5 * 10 ** 13).mul(
		mantissaSqrtScale
	);

	let usdcMint: Keypair;
	let solPerpOracle: PublicKey;

	const vaultName = 'crisp vault';
	const vault = getVaultAddressSync(program.programId, encodeName(vaultName));

	const protocolVaultName = 'protocol vault';
	const protocolVault = getVaultAddressSync(
		program.programId,
		encodeName(protocolVaultName)
	);

	const VAULT_PROTOCOL_DISCRIM: number[] = [106, 130, 5, 195, 126, 82, 249, 53];

	const initialSolPerpPrice = 100;
	const finalSolPerpPrice = initialSolPerpPrice + 10;
	const usdcAmount = new BN(1_000).mul(QUOTE_PRECISION);
	const baseAssetAmount = new BN(1).mul(BASE_PRECISION);

	before(async () => {
		usdcMint = await mockUSDCMint(provider);
		solPerpOracle = await mockOracle(initialSolPerpPrice, undefined, undefined);

		const perpMarketIndexes = [0];
		const spotMarketIndexes = [0];
		const oracleInfos = [
			{ publicKey: solPerpOracle, source: OracleSource.PYTH },
		];

		adminClient = new AdminClient({
			connection,
			wallet: provider.wallet,
			opts: {
				commitment: 'confirmed',
			},
			activeSubAccountId: 0,
			perpMarketIndexes,
			spotMarketIndexes,
			oracleInfos,
			accountSubscription: {
				type: 'websocket',
				resubTimeoutMs: 30_000,
			},
		});

		await adminClient.initialize(usdcMint.publicKey, true);
		await adminClient.subscribe();
		await initializeQuoteSpotMarket(adminClient, usdcMint.publicKey);

		const periodicity = new BN(0); // 1 HOUR
		await adminClient.initializePerpMarket(
			0,
			solPerpOracle,
			ammInitialBaseAssetReserve,
			ammInitialQuoteAssetReserve,
			periodicity,
			new BN(initialSolPerpPrice).mul(PEG_PRECISION)
		);
		await adminClient.updatePerpAuctionDuration(new BN(0));
		await adminClient.updatePerpMarketCurveUpdateIntensity(0, 100);

		// init vault manager
		const bootstrapManager = await bootstrapSignerClientAndUser({
			payer: provider,
			programId: program.programId,
			usdcMint,
			usdcAmount,
			driftClientConfig: {
				accountSubscription: {
					type: 'websocket',
					resubTimeoutMs: 30_000,
				},
				opts,
				activeSubAccountId: 0,
				perpMarketIndexes,
				spotMarketIndexes,
				oracleInfos,
			},
		});
		manager = bootstrapManager.signer;
		managerClient = bootstrapManager.vaultClient;
		managerUser = bootstrapManager.user;

		// init delegate who trades with vault funds
		const bootstrapDelegate = await bootstrapSignerClientAndUser({
			payer: provider,
			programId: program.programId,
			usdcMint,
			usdcAmount,
			skipUser: true,
			driftClientConfig: {
				accountSubscription: {
					type: 'websocket',
					resubTimeoutMs: 30_000,
				},
				opts,
				activeSubAccountId: 0,
				perpMarketIndexes,
				spotMarketIndexes,
				oracleInfos,
			},
		});
		delegate = bootstrapDelegate.signer;
		delegateClient = bootstrapDelegate.vaultClient;
		_delegateUser = bootstrapDelegate.user;

		// init a market filler for manager to trade against
		const bootstrapFiller = await bootstrapSignerClientAndUser({
			payer: provider,
			programId: program.programId,
			usdcMint,
			usdcAmount,
			depositCollateral: true,
			driftClientConfig: {
				accountSubscription: {
					type: 'websocket',
					resubTimeoutMs: 30_000,
				},
				opts,
				activeSubAccountId: 0,
				perpMarketIndexes,
				spotMarketIndexes,
				oracleInfos,
			},
		});
		fillerClient = bootstrapFiller.vaultClient;
		fillerUser = bootstrapFiller.user;

		// the VaultDepositor for the protocol vault
		const bootstrapVD = await bootstrapSignerClientAndUser({
			payer: provider,
			programId: program.programId,
			usdcMint,
			usdcAmount,
			depositCollateral: false,
			driftClientConfig: {
				accountSubscription: {
					type: 'websocket',
					resubTimeoutMs: 30_000,
				},
				opts,
				activeSubAccountId: 0,
				perpMarketIndexes,
				spotMarketIndexes,
				oracleInfos,
			},
		});
		vd = bootstrapVD.signer;
		vdClient = bootstrapVD.vaultClient;
		vdUser = bootstrapVD.user;
		vdUserUSDCAccount = bootstrapVD.userUSDCAccount;

		// the VaultDepositor for the vault
		const bootstrapVD2 = await bootstrapSignerClientAndUser({
			payer: provider,
			programId: program.programId,
			usdcMint,
			usdcAmount,
			skipUser: true,
			depositCollateral: false,
			driftClientConfig: {
				accountSubscription: {
					type: 'websocket',
					resubTimeoutMs: 30_000,
				},
				opts,
				activeSubAccountId: 0,
				perpMarketIndexes,
				spotMarketIndexes,
				oracleInfos,
			},
		});
		vd2 = bootstrapVD2.signer;
		vd2Client = bootstrapVD2.vaultClient;
		vd2UserUSDCAccount = bootstrapVD2.userUSDCAccount;
		_vd2User = bootstrapVD2.user;

		// init protocol
		const bootstrapProtocol = await bootstrapSignerClientAndUser({
			payer: provider,
			programId: program.programId,
			usdcMint,
			usdcAmount,
			skipUser: true,
			driftClientConfig: {
				accountSubscription: {
					type: 'websocket',
					resubTimeoutMs: 30_000,
				},
				opts,
				activeSubAccountId: 0,
				perpMarketIndexes,
				spotMarketIndexes,
				oracleInfos,
			},
		});
		protocol = bootstrapProtocol.signer;
		protocolClient = bootstrapProtocol.vaultClient;
		protocolVdUserUSDCAccount = bootstrapProtocol.userUSDCAccount;
		_protocolUser = bootstrapProtocol.user;

		// start account loader
		bulkAccountLoader.startPolling();
		await bulkAccountLoader.load();
	});

	after(async () => {
		bulkAccountLoader.stopPolling();

		await managerClient.driftClient.unsubscribe();
		await fillerClient.driftClient.unsubscribe();
		await vdClient.driftClient.unsubscribe();
		await vd2Client.driftClient.unsubscribe();
		await delegateClient.driftClient.unsubscribe();
		await protocolClient.driftClient.unsubscribe();
		await adminClient.unsubscribe();

		await managerUser.unsubscribe();
		await fillerUser.unsubscribe();
		await vdUser.subscribe();
		await _vd2User.unsubscribe();
		await _delegateUser.unsubscribe();
		await _protocolUser.unsubscribe();

		await managerClient.unsubscribe();
		await fillerClient.unsubscribe();
		await vdClient.unsubscribe();
		await vd2Client.unsubscribe();
		await delegateClient.unsubscribe();
		await protocolClient.unsubscribe();
	});

	//
	// Legacy vault tests
	//

	it('Initialize Vault', async () => {
		await managerClient.initializeVault({
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
		assert(adminClient.getStateAccount().numberOfAuthorities.eq(new BN(7)));
		assert(adminClient.getStateAccount().numberOfSubAccounts.eq(new BN(7)));
	});

	it('Initialize Vault Depositor', async () => {
		await vd2Client.initializeVaultDepositor(vault, vd2.publicKey);
	});

	it('Deposit', async () => {
		const vaultAccount = await program.account.vault.fetch(vault);
		const vaultDepositor = getVaultDepositorAddressSync(
			program.programId,
			vault,
			vd2.publicKey
		);
		const remainingAccounts = vd2Client.driftClient.getRemainingAccounts({
			userAccounts: [],
			writableSpotMarketIndexes: [0],
		});

		const txSig = await vd2Client.program.methods
			.deposit(usdcAmount)
			.accounts({
				userTokenAccount: vd2UserUSDCAccount.publicKey,
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
			vd2.publicKey
		);
		const remainingAccounts = vd2Client.driftClient.getRemainingAccounts({
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
		const requestTxSig = await vd2Client.program.methods
			.requestWithdraw(usdcAmount, WithdrawUnit.TOKEN)
			.accounts({
				vault,
				vaultDepositor,
				driftUser: vaultAccount.user,
				driftUserStats: vaultAccount.userStats,
				driftState: await adminClient.getStatePublicKey(),
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
			const txSig = await vd2Client.program.methods
				.withdraw()
				.accounts({
					userTokenAccount: vd2UserUSDCAccount.publicKey,
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
		const txSig = await managerClient.program.methods
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
			driftClient,
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
		assert(adminClient.getStateAccount().numberOfAuthorities.eq(new BN(9)));
		assert(adminClient.getStateAccount().numberOfSubAccounts.eq(new BN(9)));

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
			driftClient,
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
				// @ts-ignore
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

	//
	// Protocol vault tests
	//

	it('Initialize Protocol Vault', async () => {
		const vpParams: VaultProtocolParams = {
			protocol: protocol.publicKey,
			protocolFee: new BN(0),
			// 100_000 = 10%
			protocolProfitShare: 100_000,
		};
		await managerClient.initializeVault({
			name: encodeName(protocolVaultName),
			spotMarketIndex: 0,
			redeemPeriod: ZERO,
			maxTokens: ZERO,
			managementFee: ZERO,
			profitShare: 0,
			hurdleRate: 0,
			permissioned: false,
			minDepositAmount: ZERO,
			vaultProtocol: vpParams,
		});
		const vaultAcct = await program.account.vault.fetch(protocolVault);
		assert(vaultAcct.manager.equals(manager.publicKey));
		const vp = getVaultProtocolAddressSync(
			managerClient.program.programId,
			protocolVault
		);
		// asserts "exit" was called on VaultProtocol to define the discriminator
		const vpAcctInfo = await connection.getAccountInfo(vp);
		assert(vpAcctInfo.data.includes(Buffer.from(VAULT_PROTOCOL_DISCRIM)));

		// asserts Vault and VaultProtocol fields were set properly
		const vpAcct = await program.account.vaultProtocol.fetch(vp);
		assert(vaultAcct.vaultProtocol.equals(vp));
		assert(vpAcct.protocol.equals(protocol.publicKey));
	});

	// assign "delegate" to trade on behalf of the vault
	it('Update Protocol Vault Delegate', async () => {
		const vaultAccount = await program.account.vault.fetch(protocolVault);
		await managerClient.program.methods
			.updateDelegate(delegate.publicKey)
			.accounts({
				vault: protocolVault,
				driftUser: vaultAccount.user,
				driftProgram: adminClient.program.programId,
			})
			.rpc();
		const user = (await adminClient.program.account.user.fetch(
			vaultAccount.user
		)) as UserAccount;
		assert(user.delegate.equals(delegate.publicKey));
	});

	it('Initialize Vault Depositor', async () => {
		await vdClient.initializeVaultDepositor(protocolVault, vd.publicKey);
		const vaultDepositor = getVaultDepositorAddressSync(
			program.programId,
			protocolVault,
			vd.publicKey
		);
		const vdAcct = await program.account.vaultDepositor.fetch(vaultDepositor);
		assert(vdAcct.vault.equals(protocolVault));
	});

	// vault depositor deposits USDC to the vault
	it('Vault Depositor Deposit', async () => {
		const vaultAccount = await program.account.vault.fetch(protocolVault);
		const vaultDepositor = getVaultDepositorAddressSync(
			program.programId,
			protocolVault,
			vd.publicKey
		);
		const remainingAccounts = vdClient.driftClient.getRemainingAccounts({
			userAccounts: [],
			writableSpotMarketIndexes: [0],
		});
		if (!vaultAccount.vaultProtocol.equals(SystemProgram.programId)) {
			const vaultProtocol = getVaultProtocolAddressSync(
				managerClient.program.programId,
				protocolVault
			);
			remainingAccounts.push({
				pubkey: vaultProtocol,
				isSigner: false,
				isWritable: true,
			});
		}

		await vdClient.program.methods
			.deposit(usdcAmount)
			.accounts({
				vault: protocolVault,
				vaultDepositor,
				vaultTokenAccount: vaultAccount.tokenAccount,
				driftUserStats: vaultAccount.userStats,
				driftUser: vaultAccount.user,
				driftState: await adminClient.getStatePublicKey(),
				userTokenAccount: vdUserUSDCAccount.publicKey,
				driftSpotMarketVault: adminClient.getSpotMarketAccount(0).vault,
				driftProgram: adminClient.program.programId,
			})
			.remainingAccounts(remainingAccounts)
			.rpc();
	});

	// vault enters long
	it('Long SOL-PERP', async () => {
		// vault user account is delegated to "delegate"
		const vaultUserAcct = (
			await delegateClient.driftClient.getUserAccountsForDelegate(
				delegate.publicKey
			)
		)[0];
		assert(vaultUserAcct.authority.equals(protocolVault));
		assert(vaultUserAcct.delegate.equals(delegate.publicKey));

		assert(vaultUserAcct.totalDeposits.eq(usdcAmount));
		const balance =
			vaultUserAcct.totalDeposits.toNumber() / QUOTE_PRECISION.toNumber();
		console.log('vault usdc balance:', balance);

		const marketIndex = 0;

		// delegate assumes control of vault user
		await delegateClient.driftClient.addUser(0, protocolVault, vaultUserAcct);
		await delegateClient.driftClient.switchActiveUser(0, protocolVault);
		console.log('delegate assumed control of protocol vault user');

		const delegateActiveUser = delegateClient.driftClient.getUser(
			0,
			protocolVault
		);
		const vaultUserKey = await getUserAccountPublicKey(
			delegateClient.driftClient.program.programId,
			protocolVault,
			0
		);
		assert(
			delegateActiveUser.userAccountPublicKey.equals(vaultUserKey),
			'delegate active user is not vault user'
		);

		const fillerUser = fillerClient.driftClient.getUser();

		try {
			// manager places long order and waits to be filler by the filler
			const takerOrderParams = getLimitOrderParams({
				marketIndex,
				direction: PositionDirection.SHORT,
				baseAssetAmount,
				price: new BN((initialSolPerpPrice - 1) * PRICE_PRECISION.toNumber()),
				auctionStartPrice: new BN(
					initialSolPerpPrice * PRICE_PRECISION.toNumber()
				),
				auctionEndPrice: new BN(
					(initialSolPerpPrice - 1) * PRICE_PRECISION.toNumber()
				),
				auctionDuration: 10,
				userOrderId: 1,
				postOnly: PostOnlyParams.NONE,
			});
			await fillerClient.driftClient.placePerpOrder(takerOrderParams);
		} catch (e) {
			console.log('filler failed to short:', e);
		}
		await fillerUser.fetchAccounts();
		const order = fillerUser.getOrderByUserOrderId(1);
		assert(!order.postOnly);

		try {
			// vault trades against filler's long
			const makerOrderParams = getLimitOrderParams({
				marketIndex,
				direction: PositionDirection.LONG,
				baseAssetAmount,
				price: new BN(initialSolPerpPrice).mul(PRICE_PRECISION),
				userOrderId: 1,
				postOnly: PostOnlyParams.MUST_POST_ONLY,
				immediateOrCancel: true,
			});
			const orderParams = getOrderParams(makerOrderParams, {
				marketType: MarketType.PERP,
			});
			const userStatsPublicKey =
				delegateClient.driftClient.getUserStatsAccountPublicKey();

			const remainingAccounts = delegateClient.driftClient.getRemainingAccounts(
				{
					userAccounts: [
						delegateActiveUser.getUserAccount(),
						fillerUser.getUserAccount(),
					],
					useMarketLastSlotCache: true,
					writablePerpMarketIndexes: [orderParams.marketIndex],
				}
			);

			const takerOrderId = order.orderId;
			const placeAndMakeOrderIx =
				await delegateClient.driftClient.program.methods
					.placeAndMakePerpOrder(orderParams, takerOrderId)
					.accounts({
						state: await delegateClient.driftClient.getStatePublicKey(),
						user: delegateActiveUser.userAccountPublicKey,
						userStats: userStatsPublicKey,
						taker: fillerUser.userAccountPublicKey,
						takerStats: fillerClient.driftClient.getUserStatsAccountPublicKey(),
						authority: delegateClient.driftClient.wallet.publicKey,
					})
					.remainingAccounts(remainingAccounts)
					.instruction();

			const { slot } = await delegateClient.driftClient.sendTransaction(
				await delegateClient.driftClient.buildTransaction(
					placeAndMakeOrderIx,
					delegateClient.driftClient.txParams
				),
				[],
				delegateClient.driftClient.opts
			);

			delegateClient.driftClient.perpMarketLastSlotCache.set(
				orderParams.marketIndex,
				slot
			);
		} catch (e) {
			console.log('vault failed to long:', e);
		}

		// check positions from vault and filler are accurate
		await fillerUser.fetchAccounts();
		const fillerPosition = fillerUser.getPerpPosition(0);
		assert(
			fillerPosition.baseAssetAmount.eq(baseAssetAmount.neg()),
			'filler position is not baseAssetAmount'
		);
		await delegateActiveUser.fetchAccounts();
		const vaultPosition = delegateActiveUser.getPerpPosition(0);
		assert(
			vaultPosition.baseAssetAmount.eq(baseAssetAmount),
			'vault position is not baseAssetAmount'
		);
	});

	// increase price of SOL perp by 5%
	it('Increase SOL-PERP Price', async () => {
		const preOD = adminClient.getOracleDataForPerpMarket(0);
		const priceBefore = preOD.price.toNumber() / PRICE_PRECISION.toNumber();
		console.log('price before:', priceBefore);
		assert(priceBefore === initialSolPerpPrice);

		try {
			// increase AMM
			await adminClient.moveAmmToPrice(
				0,
				new BN(finalSolPerpPrice * PRICE_PRECISION.toNumber())
			);
		} catch (e) {
			console.log('failed to move amm price:', e);
			assert(false);
		}

		const solPerpMarket = adminClient.getPerpMarketAccount(0);

		try {
			// increase oracle
			await setFeedPrice(
				anchor.workspace.Pyth,
				finalSolPerpPrice,
				solPerpMarket.amm.oracle
			);
		} catch (e) {
			console.log('failed to set feed price:', e);
			assert(false);
		}

		const postOD = adminClient.getOracleDataForPerpMarket(0);
		const priceAfter = postOD.price.toNumber() / PRICE_PRECISION.toNumber();
		console.log('price after:', priceAfter);
		assert(priceAfter === finalSolPerpPrice);
	});

	// vault exits long for a profit
	it('Short SOL-PERP', async () => {
		const marketIndex = 0;

		const delegateActiveUser = delegateClient.driftClient.getUser(
			0,
			protocolVault
		);
		const fillerUser = fillerClient.driftClient.getUser();

		try {
			// manager places long order and waits to be filler by the filler
			const takerOrderParams = getLimitOrderParams({
				marketIndex,
				direction: PositionDirection.LONG,
				baseAssetAmount,
				price: new BN((finalSolPerpPrice + 1) * PRICE_PRECISION.toNumber()),
				auctionStartPrice: new BN(
					finalSolPerpPrice * PRICE_PRECISION.toNumber()
				),
				auctionEndPrice: new BN(
					(finalSolPerpPrice + 1) * PRICE_PRECISION.toNumber()
				),
				auctionDuration: 10,
				userOrderId: 1,
				postOnly: PostOnlyParams.NONE,
			});
			await fillerClient.driftClient.placePerpOrder(takerOrderParams);
		} catch (e) {
			console.log('filler failed to long:', e);
		}
		await fillerUser.fetchAccounts();
		const order = fillerUser.getOrderByUserOrderId(1);
		assert(!order.postOnly);

		try {
			// vault trades against filler's long
			const makerOrderParams = getLimitOrderParams({
				marketIndex,
				direction: PositionDirection.SHORT,
				baseAssetAmount,
				price: new BN(finalSolPerpPrice).mul(PRICE_PRECISION),
				userOrderId: 1,
				postOnly: PostOnlyParams.MUST_POST_ONLY,
				immediateOrCancel: true,
			});
			const orderParams = getOrderParams(makerOrderParams, {
				marketType: MarketType.PERP,
			});
			const userStatsPublicKey =
				delegateClient.driftClient.getUserStatsAccountPublicKey();

			const remainingAccounts = delegateClient.driftClient.getRemainingAccounts(
				{
					userAccounts: [
						delegateActiveUser.getUserAccount(),
						fillerUser.getUserAccount(),
					],
					useMarketLastSlotCache: true,
					writablePerpMarketIndexes: [orderParams.marketIndex],
				}
			);

			const takerOrderId = order.orderId;
			const placeAndMakeOrderIx =
				await delegateClient.driftClient.program.methods
					.placeAndMakePerpOrder(orderParams, takerOrderId)
					.accounts({
						state: await delegateClient.driftClient.getStatePublicKey(),
						user: delegateActiveUser.userAccountPublicKey,
						userStats: userStatsPublicKey,
						taker: fillerUser.userAccountPublicKey,
						takerStats: fillerClient.driftClient.getUserStatsAccountPublicKey(),
						authority: delegateClient.driftClient.wallet.publicKey,
					})
					.remainingAccounts(remainingAccounts)
					.instruction();

			const { slot } = await delegateClient.driftClient.sendTransaction(
				await delegateClient.driftClient.buildTransaction(
					placeAndMakeOrderIx,
					delegateClient.driftClient.txParams
				),
				[],
				delegateClient.driftClient.opts
			);

			delegateClient.driftClient.perpMarketLastSlotCache.set(
				orderParams.marketIndex,
				slot
			);
		} catch (e) {
			console.log('vault failed to short:', e);
		}

		// check positions from vault and filler are accurate
		await fillerUser.fetchAccounts();
		const fillerPosition = fillerUser.getPerpPosition(0);
		assert(fillerPosition.baseAssetAmount.eq(ZERO));
		await delegateActiveUser.fetchAccounts();
		const vaultPosition = delegateActiveUser.getPerpPosition(0);
		assert(vaultPosition.baseAssetAmount.eq(ZERO));
	});

	it('Settle Pnl', async () => {
		const vaultUser = delegateClient.driftClient.getUser(0, protocolVault);
		const uA = vaultUser.getUserAccount();
		assert(uA.idle === false);
		const solPerpPos = vaultUser.getPerpPosition(0);
		const solPerpQuote =
			solPerpPos.quoteAssetAmount.toNumber() / QUOTE_PRECISION.toNumber();
		console.log('sol perp quote:', solPerpQuote);
		console.log(
			'sol perp base:',
			solPerpPos.baseAssetAmount.toNumber() / BASE_PRECISION.toNumber()
		);
		assert(solPerpPos.baseAssetAmount.eq(ZERO));
		console.log(
			'free collateral:',
			vaultUser.getFreeCollateral().toNumber() / QUOTE_PRECISION.toNumber()
		);
		assert(usdcAmount.eq(vaultUser.getFreeCollateral()));

		const solPrice = vaultUser.driftClient.getOracleDataForPerpMarket(0);
		console.log(
			'SOL price:',
			solPrice.price.toNumber() / PRICE_PRECISION.toNumber()
		);
		assert(
			finalSolPerpPrice ===
				solPrice.price.toNumber() / PRICE_PRECISION.toNumber()
		);

		const solPerpMarket = delegateClient.driftClient.getPerpMarketAccount(0);
		const pnl =
			calculatePositionPNL(
				solPerpMarket,
				solPerpPos,
				false,
				solPrice
			).toNumber() / QUOTE_PRECISION.toNumber();

		const upnl =
			vaultUser.getUnrealizedPNL().toNumber() / QUOTE_PRECISION.toNumber();
		console.log('upnl:', upnl.toString());
		assert(pnl === upnl);
		assert(
			solPerpPos.quoteAssetAmount.toNumber() / QUOTE_PRECISION.toNumber() ==
				upnl
		);
		assert(solPerpQuote === pnl);

		await vaultUser.fetchAccounts();
		try {
			// settle market maker who lost trade and pays taker fees
			await delegateClient.driftClient.settlePNL(
				fillerUser.userAccountPublicKey,
				fillerUser.getUserAccount(),
				0
			);
			// then settle vault who won trade and earns maker fees
			await delegateClient.driftClient.settlePNL(
				vaultUser.userAccountPublicKey,
				vaultUser.getUserAccount(),
				0
			);
		} catch (e) {
			console.log('failed to settle pnl:', e);
			assert(false);
		}

		// vault user account is delegated to "delegate"
		const vaultUserAcct = delegateClient.driftClient
			.getUser(0, protocolVault)
			.getUserAccount();
		const settledPnl =
			vaultUserAcct.settledPerpPnl.toNumber() / QUOTE_PRECISION.toNumber();
		console.log('vault settled pnl:', settledPnl);
		assert(settledPnl === pnl);
	});

	it('Withdraw', async () => {
		const vaultDepositor = getVaultDepositorAddressSync(
			program.programId,
			protocolVault,
			vd.publicKey
		);

		const vaultAccount = await program.account.vault.fetch(protocolVault);
		const vaultDepositorAccount = await program.account.vaultDepositor.fetch(
			vaultDepositor
		);

		const remainingAccounts = vdClient.driftClient.getRemainingAccounts({
			userAccounts: [],
			writableSpotMarketIndexes: [0],
		});
		if (!vaultAccount.vaultProtocol.equals(SystemProgram.programId)) {
			const vaultProtocol = vdClient.getVaultProtocolAddress(
				vaultDepositorAccount.vault
			);
			remainingAccounts.push({
				pubkey: vaultProtocol,
				isSigner: false,
				isWritable: true,
			});
		}

		const withdrawAmount =
			await vdClient.calculateWithdrawableVaultDepositorEquityInDepositAsset({
				vaultDepositor: vaultDepositorAccount,
				vault: vaultAccount,
			});
		console.log(
			'withdraw amount:',
			withdrawAmount.toNumber() / QUOTE_PRECISION.toNumber()
		);
		// $1000 deposit + (~$10.04 in profit - 10% profit share = ~$9.04)
		assert(
			withdrawAmount.toNumber() / QUOTE_PRECISION.toNumber() === 1009.037051
		);

		try {
			await vdClient.program.methods
				.requestWithdraw(withdrawAmount, WithdrawUnit.TOKEN)
				.accounts({
					vault: protocolVault,
					vaultDepositor,
					driftUser: vaultAccount.user,
					driftUserStats: vaultAccount.userStats,
					driftState: await adminClient.getStatePublicKey(),
				})
				.remainingAccounts(remainingAccounts)
				.rpc();
		} catch (e) {
			console.log('failed to request withdraw:', e);
			assert(false);
		}

		const vaultDepositorAccountAfter =
			await program.account.vaultDepositor.fetch(vaultDepositor);
		console.log(
			'withdraw shares:',
			vaultDepositorAccountAfter.lastWithdrawRequest.shares.toNumber()
		);
		console.log(
			'withdraw value:',
			vaultDepositorAccountAfter.lastWithdrawRequest.value.toNumber()
		);
		assert(
			vaultDepositorAccountAfter.lastWithdrawRequest.shares.eq(
				new BN(999_005_866)
			)
		);
		assert(
			vaultDepositorAccountAfter.lastWithdrawRequest.value.eq(
				new BN(1_009_037_051)
			)
		);

		const vdAcct = await program.account.vaultDepositor.fetch(vaultDepositor);
		assert(vdAcct.vault.equals(protocolVault));

		try {
			const vaultAccount = await program.account.vault.fetch(protocolVault);

			await vdClient.program.methods
				.withdraw()
				.accounts({
					userTokenAccount: vdUserUSDCAccount.publicKey,
					vault: protocolVault,
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
		} catch (e) {
			console.log('failed to withdraw:', e);
			assert(false);
		}
	});

	it('Protocol Withdraw Profit Share', async () => {
		const vaultAccount = await program.account.vault.fetch(protocolVault);

		const remainingAccounts = protocolClient.driftClient.getRemainingAccounts({
			userAccounts: [],
			writableSpotMarketIndexes: [0],
		});
		const vaultProtocol = getVaultProtocolAddressSync(
			program.programId,
			protocolVault
		);
		if (!vaultAccount.vaultProtocol.equals(SystemProgram.programId)) {
			remainingAccounts.push({
				pubkey: vaultProtocol,
				isSigner: false,
				isWritable: true,
			});
		}

		const withdrawAmount = await protocolClient.calculateVaultProtocolEquity({
			vault: protocolVault,
		});
		console.log(
			'protocol withdraw profit share:',
			withdrawAmount.toNumber() / QUOTE_PRECISION.toNumber()
		);
		// 10% of protocolVault depositor's ~$10.04 profit
		assert(withdrawAmount.toNumber() / QUOTE_PRECISION.toNumber() === 1.004114);

		try {
			await protocolClient.program.methods
				.protocolRequestWithdraw(withdrawAmount, WithdrawUnit.TOKEN)
				.accounts({
					vault: protocolVault,
					vaultProtocol,
					driftUser: vaultAccount.user,
					driftUserStats: vaultAccount.userStats,
					driftState: await adminClient.getStatePublicKey(),
				})
				.remainingAccounts(remainingAccounts)
				.rpc();
		} catch (e) {
			console.log('failed to request withdraw:', e);
			assert(false);
		}

		const vpAccountAfter = await program.account.vaultProtocol.fetch(
			vaultProtocol
		);
		console.log(
			'protocol withdraw shares:',
			vpAccountAfter.lastProtocolWithdrawRequest.shares.toNumber()
		);
		console.log(
			'protocol withdraw value:',
			vpAccountAfter.lastProtocolWithdrawRequest.value.toNumber()
		);
		assert(
			vpAccountAfter.lastProtocolWithdrawRequest.shares.eq(new BN(994_132))
		);
		assert(
			vpAccountAfter.lastProtocolWithdrawRequest.value.eq(new BN(1_004_114))
		);

		try {
			const vaultAccount = await program.account.vault.fetch(protocolVault);

			await protocolClient.program.methods
				.protocolWithdraw()
				.accounts({
					userTokenAccount: protocolVdUserUSDCAccount.publicKey,
					vault: protocolVault,
					vaultProtocol,
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
		} catch (e) {
			console.log('failed to withdraw:', e);
			assert(false);
		}
	});
});
