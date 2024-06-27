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
	PEG_PRECISION,
	PublicKey,
	BASE_PRECISION,

	MarketStatus,
	calculateReservePrice,
	getLimitOrderParams,
	PostOnlyParams,
	PositionDirection,
} from '@drift-labs/sdk';
import {
	bootstrapSignerClientAndUser,
	initializeQuoteSpotMarket,
	mockOracle,
	mockUSDCMint,
	printTxLogs,
} from './testHelpers';
import {
	Keypair,
} from '@solana/web3.js';
import { assert } from 'chai';
import {
	VaultClient,
	getVaultAddressSync,
	getVaultDepositorAddressSync,
	encodeName,
	DriftVaults,
	VaultProtocolParams,
	getVaultProtocolAddressSync,
} from '../ts/sdk';

describe('driftProtocolVaults', () => {
	// Configure the client to use the local cluster.
	const provider = anchor.AnchorProvider.local(undefined, {
		preflightCommitment: 'confirmed',
		skipPreflight: false,
		commitment: 'confirmed',
	});
	anchor.setProvider(provider);
	const connection = provider.connection;
	const program = anchor.workspace.DriftVaults as Program<DriftVaults>;

	const bulkAccountLoader = new BulkAccountLoader(connection, 'confirmed', 1);

	const adminClient = new AdminClient({
		connection,
		wallet: provider.wallet,
		accountSubscription: {
			type: 'websocket',
			resubTimeoutMs: 30_000,
		},
	});

	let manager: Keypair;
	let managerClient: VaultClient;
	let managerUser: User;

	// let maker: Keypair;
	let makerClient: VaultClient;
	let makerUser: User;
	// let makerUserUSDCAccount: Keypair;

	let vd: Keypair;
	let vdClient: VaultClient;
	let vdUser: User;
	let vdUserUSDCAccount: Keypair;

	// ammInvariant == k == x * y
	const mantissaSqrtScale = new BN(Math.sqrt(PRICE_PRECISION.toNumber()));
	const ammInitialQuoteAssetReserve = new BN(5 * 10 ** 13).mul(
		mantissaSqrtScale
	);
	const ammInitialBaseAssetReserve = new BN(5 * 10 ** 13).mul(
		mantissaSqrtScale
	);

	let usdcMint: Keypair;
	let solPerpOracle: PublicKey;

	const protocol = Keypair.generate().publicKey;
	const vaultName = 'protocol vault';
	const vault = getVaultAddressSync(program.programId, encodeName(vaultName));

	const usdcAmount = new BN(100 * 10 ** 6);

	const VAULT_PROTOCOL_DISCRIM: number[] = [106, 130, 5, 195, 126, 82, 249, 53];

	before(async () => {
		usdcMint = await mockUSDCMint(provider);
		solPerpOracle = await mockOracle(1);
		const perpMarketIndexes = [0];
		const spotMarketIndexes = [0, 1];
		const oracleInfos = [{ publicKey: solPerpOracle, source: OracleSource.PYTH }];

		const setupClient = new AdminClient({
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
				type: 'polling',
				accountLoader: bulkAccountLoader,
			},
		});

		await setupClient.initialize(usdcMint.publicKey, true);
		await setupClient.subscribe();
		await initializeQuoteSpotMarket(setupClient, usdcMint.publicKey);

		await setupClient.initializePerpMarket(
			0,
			solPerpOracle,
			ammInitialBaseAssetReserve,
			ammInitialQuoteAssetReserve,
			new BN(0),
			new BN(32 * PEG_PRECISION.toNumber())
		);
		await setupClient.updatePerpMarketStatus(0, MarketStatus.ACTIVE);
		await setupClient.updatePerpMarketBaseSpread(0, 500);
		await setupClient.unsubscribe();

		// init manager who manages vault assets
		const bootstrapManager = await bootstrapSignerClientAndUser({
			payer: provider,
			programId: program.programId,
			usdcMint,
			usdcAmount,
			accountSubscription: {
				type: 'websocket',
				resubTimeoutMs: 30_000,
			},
			opts: {
				preflightCommitment: 'confirmed',
				skipPreflight: false,
				commitment: 'confirmed',
			},
			activeSubAccountId: 0,
			perpMarketIndexes,
			spotMarketIndexes,
			oracleInfos,
		});
		manager = bootstrapManager.signer;
		managerClient = bootstrapManager.vaultClient;
		managerUser = bootstrapManager.user;

		// init a market maker for manager to trade against
		const bootstrapMaker = await bootstrapSignerClientAndUser({
			payer: provider,
			programId: program.programId,
			usdcMint,
			usdcAmount,
			accountSubscription: {
				type: 'websocket',
				resubTimeoutMs: 30_000,
			},
			opts: {
				preflightCommitment: 'confirmed',
				skipPreflight: false,
				commitment: 'confirmed',
			},
			activeSubAccountId: 0,
			perpMarketIndexes,
			spotMarketIndexes,
			oracleInfos,
		});
		// maker = bootstrapMaker.signer;
		makerClient = bootstrapMaker.vaultClient;
		makerUser = bootstrapMaker.user;
		// makerUserUSDCAccount = bootstrapMaker.userUSDCAccount;

		// init VaultDepositor for manager to trade on behalf of.
		// the VaultDepositor is the admin/provider.wallet.
		const bootstrapVD = await bootstrapSignerClientAndUser({
			payer: provider,
			programId: program.programId,
			usdcMint,
			usdcAmount,
			accountSubscription: {
				type: 'websocket',
				resubTimeoutMs: 30_000,
			},
			opts: {
				preflightCommitment: 'confirmed',
				skipPreflight: false,
				commitment: 'confirmed',
			},
			activeSubAccountId: 0,
			perpMarketIndexes,
			spotMarketIndexes,
			oracleInfos,
		});
		vd = bootstrapVD.signer;
		vdClient = bootstrapVD.vaultClient;
		vdUser = bootstrapVD.user;
		vdUserUSDCAccount = bootstrapVD.userUSDCAccount;

		// start admin client
		await adminClient.subscribe();

		// start account loader
		bulkAccountLoader.startPolling();
		await bulkAccountLoader.load();
	});

	after(async () => {
		await managerClient.driftClient.unsubscribe();
		await makerClient.driftClient.unsubscribe();
		await vdClient.driftClient.unsubscribe();
		await adminClient.unsubscribe();

		await managerUser.unsubscribe();
		await makerUser.unsubscribe();
		await vdUser.subscribe();

		bulkAccountLoader.stopPolling();
	});

	it('Initialize Protocol Vault', async () => {
		const vpParams: VaultProtocolParams = {
			protocol,
			protocolFee: new BN(0),
			protocolProfitShare: 0,
		};
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
			vaultProtocol: vpParams,
		});
		const vaultAcct = await managerClient.program.account.vault.fetch(vault);
		assert(vaultAcct.manager.equals(manager.publicKey));
		const vp = getVaultProtocolAddressSync(managerClient.program.programId, vault);
		// asserts "exit" was called on VaultProtocol to define the discriminator
		const vpAcctInfo = await connection.getAccountInfo(vp);
		assert(vpAcctInfo.data.includes(Buffer.from(VAULT_PROTOCOL_DISCRIM)));

		// asserts Vault and VaultProtocol fields were set properly
		const vpAcct = await managerClient.program.account.vaultProtocol.fetch(vp);
		assert(vaultAcct.vaultProtocol.equals(vp));
		assert(vpAcct.protocol.equals(protocol));
	});

	it('Initialize Vault Depositor', async () => {
		await vdClient.initializeVaultDepositor(vault, vd.publicKey);
		const vaultDepositor = getVaultDepositorAddressSync(
			vdClient.program.programId,
			vault,
			vd.publicKey
		);
		const vdAcct = await vdClient.program.account.vaultDepositor.fetch(vaultDepositor);
		assert(vdAcct.vault.equals(vault));
	});

	// vault depositor deposits USDC to the vault's token account
	it('Vault Depositor Deposit', async () => {
	  const vaultAccount = await vdClient.program.account.vault.fetch(vault);
	  const vaultDepositor = getVaultDepositorAddressSync(
	    vdClient.program.programId,
	    vault,
	    vd.publicKey
	  );
	  const remainingAccounts = adminClient.getRemainingAccounts({
	    userAccounts: [],
	    writableSpotMarketIndexes: [0],
	  });

	  await vdClient.program.methods
	    .deposit(usdcAmount)
	    .accounts({
	      vault,
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

	// todo: manager placeAndTake long order at 1, then maker placeAndMakeOrder short at 1
	it('Long SOL-PERP at $1', async () => {
		const baseAssetAmount = BASE_PRECISION;
		const marketIndex = 0;

		// manager places long taker order at 1
		const reservePrice = calculateReservePrice(
			managerClient.driftClient.getPerpMarketAccount(marketIndex),
			undefined
		);
		console.log('reserve price:', reservePrice.div(PRICE_PRECISION).toNumber());
		const takerOrderParams = getLimitOrderParams({
			marketIndex,
			direction: PositionDirection.LONG,
			baseAssetAmount,
			price: reservePrice,
			userOrderId: 1,
			postOnly: PostOnlyParams.NONE,
		});
		const adminTradeTxSig = await managerClient.driftClient.placePerpOrder(takerOrderParams);
		await printTxLogs(connection, adminTradeTxSig);
		await managerUser.fetchAccounts();
		const order = managerUser.getOrderByUserOrderId(1);
		assert(!order.postOnly);

		// market maker fills long order with short order at $1
		const makerOrderParams = getLimitOrderParams({
			marketIndex,
			direction: PositionDirection.SHORT,
			baseAssetAmount,
			price: reservePrice,
			userOrderId: 1,
			postOnly: PostOnlyParams.MUST_POST_ONLY,
			immediateOrCancel: true,
		});
		const makerTradeTxSig = await makerClient.driftClient.placeAndMakePerpOrder(
			makerOrderParams,
			{
				taker: await makerClient.driftClient.getUserAccountPublicKey(),
				order: makerClient.driftClient.getOrderByUserId(1),
				takerUserAccount: makerClient.driftClient.getUserAccount(),
				takerStats: makerClient.driftClient.getUserStatsAccountPublicKey(),
			}
		);
		await printTxLogs(connection, makerTradeTxSig);

		const makerPosition = makerClient.driftClient.getUser().getPerpPosition(0);
		assert(makerPosition.baseAssetAmount.eq(BASE_PRECISION.neg()));

		const managerPosition = managerClient.driftClient.getUser().getPerpPosition(0);
		assert(managerPosition.baseAssetAmount.eq(BASE_PRECISION));
	});

	// // increase price of SOL perp from $100 to $150 to simulate appreciation in vault shares by 50%
	// it('Increase SOL-PERP Price', async () => {
	//   const preOD = adminClient.getOracleDataForPerpMarket(0);
	//   const priceBefore = preOD.price.div(PRICE_PRECISION).toNumber();
	// 	assert(priceBefore == 100);
	//
	//   // SOL perp **market** sees 50% price increase
	//   await adminClient.moveAmmToPrice(
	//     0,
	//     new BN(150 * PRICE_PRECISION.toNumber())
	//   );
	//
	// 	// SOL perp **oracle** sees 50% price increase
	// 	await setFeedPrice(
	// 	anchor.workspace.Pyth,
	// 		150,
	// 		solPerpOracle
	// 	);
	//
	// 	const postOD = adminClient.getOracleDataForPerpMarket(0);
	// 	const priceAfter = postOD.price.div(PRICE_PRECISION).toNumber();
	// 	assert(priceAfter == 150);
	// });

	// todo: manager placeAndTake short order at $150, then maker placeAndMakeOrder long at $150
	// 	the manager will have effectively longed for a 50% profit

	// it('Withdraw', async () => {
	//   const vaultAccount = await program.account.vault.fetch(vault);
	//   const vaultDepositor = getVaultDepositorAddressSync(
	//     program.programId,
	//     vault,
	//     provider.wallet.publicKey
	//   );
	//   const remainingAccounts = adminClient.getRemainingAccounts({
	//     userAccounts: [],
	//     writableSpotMarketIndexes: [0],
	//   });
	//
	//   const vaultDepositorAccount = await program.account.vaultDepositor.fetch(
	//     vaultDepositor
	//   );
	//   assert(vaultDepositorAccount.lastWithdrawRequest.value.eq(new BN(0)));
	// 	// $100 initial deposit = 100_000_000 shares
	//   assert(vaultDepositorAccount.vaultShares.eq(new BN(100_000_000)));
	//
	//
	// 	const vaultEquity = (await vaultClient.calculateVaultEquityInDepositAsset({
	// 		address: vault
	// 	})).toNumber();
	// 	console.log('vaultEquity:', vaultEquity);
	// 	const vaultTotalShares = vaultAccount.totalShares.toNumber();
	// 	console.log('vaultTotalShares:', vaultTotalShares);
	// 	const vdShares = vaultDepositorAccount.vaultShares.toNumber();
	// 	console.log('vdShares:', vdShares);
	// 	const vdEquity = (vdShares / vaultTotalShares) * vaultEquity;
	// 	console.log('vdEquity:', vdEquity);
	//
	//   // request withdraw
	//   const requestTxSig = await program.methods
	//     .requestWithdraw(usdcAmount, WithdrawUnit.TOKEN)
	//     .accounts({
	//       // userTokenAccount: userUSDCAccount.publicKey,
	//       vault,
	//       vaultDepositor,
	//       driftUser: vaultAccount.user,
	//       driftUserStats: vaultAccount.userStats,
	//       driftState: await adminClient.getStatePublicKey(),
	//       // driftSpotMarketVault: adminClient.getSpotMarketAccount(0).vault,
	//       // driftSigner: adminClient.getStateAccount().signer,
	//       // driftProgram: adminClient.program.programId,
	//       // tokenProgram: TOKEN_PROGRAM_ID,
	//     })
	//     .remainingAccounts(remainingAccounts)
	//     .rpc();
	//   await printTxLogs(provider.connection, requestTxSig);
	//
	//   const vaultDepositorAccountAfter =
	//     await program.account.vaultDepositor.fetch(vaultDepositor);
	//   assert(vaultDepositorAccountAfter.vaultShares.eq(new BN(100_000_000)));
	// 	console.log('withdraw shares:', vaultDepositorAccountAfter.lastWithdrawRequest.shares.toNumber());
	// 	console.log('withdraw value:', vaultDepositorAccountAfter.lastWithdrawRequest.value.toNumber());
	//
	// 	assert(
	//     !vaultDepositorAccountAfter.lastWithdrawRequest.shares.eq(new BN(0))
	//   );
	//   assert(!vaultDepositorAccountAfter.lastWithdrawRequest.value.eq(new BN(0)));
	//
	//   // do withdraw
	//   console.log('do withdraw');
	//   try {
	//     const txSig = await program.methods
	//       .withdraw()
	//       .accounts({
	//         userTokenAccount: vdUserUSDCAccount.publicKey,
	//         vault,
	//         vaultDepositor,
	//         vaultTokenAccount: vaultAccount.tokenAccount,
	//         driftUser: vaultAccount.user,
	//         driftUserStats: vaultAccount.userStats,
	//         driftState: await adminClient.getStatePublicKey(),
	//         driftSpotMarketVault: adminClient.getSpotMarketAccount(0).vault,
	//         driftSigner: adminClient.getStateAccount().signer,
	//         driftProgram: adminClient.program.programId,
	//       })
	//       .remainingAccounts(remainingAccounts)
	//       .rpc();
	//
	//     await printTxLogs(provider.connection, txSig);
	//   } catch (e) {
	//     console.error(e);
	//     assert(false);
	//   }
	// });
});
