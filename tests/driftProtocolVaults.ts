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
	getLimitOrderParams,
	PostOnlyParams,
	PositionDirection,
	getUserAccountPublicKey,
	UserAccount,
	QUOTE_PRECISION,
} from '@drift-labs/sdk';
import {
	bootstrapSignerClientAndUser,
	initializeQuoteSpotMarket,
	mockOracle,
	mockUSDCMint,
	printTxLogs,
	setFeedPrice,
} from './testHelpers';
import { Keypair } from '@solana/web3.js';
import { assert } from 'chai';
import {
	VaultClient,
	getVaultAddressSync,
	getVaultDepositorAddressSync,
	encodeName,
	DriftVaults,
	VaultProtocolParams,
	getVaultProtocolAddressSync, WithdrawUnit, VaultDepositor,
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

	let makerClient: VaultClient;
	let makerUser: User;

	let vd: Keypair;
	let vdClient: VaultClient;
	let vdUser: User;
	let vdUserUSDCAccount: Keypair;

	let delegate: Keypair;
	let delegateClient: VaultClient;

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

	const usdcAmount = (new BN(100)).mul(QUOTE_PRECISION);

	const VAULT_PROTOCOL_DISCRIM: number[] = [106, 130, 5, 195, 126, 82, 249, 53];

	const initialSolPerpPrice = 30;
	const finalSolPerpPrice = initialSolPerpPrice * 1.5;

	before(async () => {
		usdcMint = await mockUSDCMint(provider);
		solPerpOracle = await mockOracle(initialSolPerpPrice);
		const perpMarketIndexes = [0];
		const spotMarketIndexes = [0, 1];
		const oracleInfos = [
			{ publicKey: solPerpOracle, source: OracleSource.PYTH },
		];

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

		// init vault manager
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

		// init delegate who trades with vault funds
		const bootstrapDelegate = await bootstrapSignerClientAndUser({
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
		delegate = bootstrapDelegate.signer;
		delegateClient = bootstrapDelegate.vaultClient;

		// init a market maker for manager to trade against
		const bootstrapMaker = await bootstrapSignerClientAndUser({
			payer: provider,
			programId: program.programId,
			usdcMint,
			usdcAmount,
			depositCollateral: true,
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
			depositCollateral: false,
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
		const vp = getVaultProtocolAddressSync(
			managerClient.program.programId,
			vault
		);
		// asserts "exit" was called on VaultProtocol to define the discriminator
		const vpAcctInfo = await connection.getAccountInfo(vp);
		assert(vpAcctInfo.data.includes(Buffer.from(VAULT_PROTOCOL_DISCRIM)));

		// asserts Vault and VaultProtocol fields were set properly
		const vpAcct = await managerClient.program.account.vaultProtocol.fetch(vp);
		assert(vaultAcct.vaultProtocol.equals(vp));
		assert(vpAcct.protocol.equals(protocol));
	});

	it('Update Delegate', async () => {
		const vaultAccount = await program.account.vault.fetch(vault);
		await managerClient.program.methods
			.updateDelegate(delegate.publicKey)
			.accounts({
				vault,
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
		await vdClient.initializeVaultDepositor(vault, vd.publicKey);
		const vaultDepositor = getVaultDepositorAddressSync(
			vdClient.program.programId,
			vault,
			vd.publicKey
		);
		const vdAcct = await vdClient.program.account.vaultDepositor.fetch(
			vaultDepositor
		);
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
		const vaultProtocol = getVaultProtocolAddressSync(
			managerClient.program.programId,
			vault
		);
		remainingAccounts.push({
			pubkey: vaultProtocol,
			isSigner: false,
			isWritable: true,
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

	it('Vault Long SOL-PERP', async () => {
		// vault user account is delegated to "delegate"
		const vaultUserAcct = (await delegateClient.driftClient.getUserAccountsForDelegate(
			delegate.publicKey
		))[0];
		assert(vaultUserAcct.authority.equals(vault));
		assert(vaultUserAcct.delegate.equals(delegate.publicKey));

		assert(vaultUserAcct.totalDeposits.eq(usdcAmount));
		const balance = vaultUserAcct.totalDeposits.toNumber() / QUOTE_PRECISION.toNumber();
		console.log('vault usdc balance:', balance);

		const baseAssetAmount = BASE_PRECISION;
		const marketIndex = 0;

		// manager places long order and waits to be filled by the maker
		const takerOrderParams = getLimitOrderParams({
			marketIndex,
			direction: PositionDirection.LONG,
			baseAssetAmount,
			price: new BN(initialSolPerpPrice + 1).mul(PRICE_PRECISION),
			auctionStartPrice: new BN(initialSolPerpPrice).mul(PRICE_PRECISION),
			auctionEndPrice: new BN(initialSolPerpPrice + 1).mul(PRICE_PRECISION),
			auctionDuration: 10,
			userOrderId: 1,
			postOnly: PostOnlyParams.NONE,
		});
		// delegate assumes control of vault user
		await delegateClient.driftClient.switchActiveUser(0, vault);
		await delegateClient.driftClient.addUser(0, vault, vaultUserAcct);
		console.log('delegate assumed control of vault user');

		const delegateActiveUser = delegateClient.driftClient.getUser(0, vault);
		const vaultUserKey = await getUserAccountPublicKey(
			delegateClient.driftClient.program.programId,
			vault,
			0
		);
		assert(delegateActiveUser.userAccountPublicKey.equals(vaultUserKey));

		try {
			await delegateClient.driftClient.placePerpOrder(takerOrderParams);
		} catch (e) {
			console.log('vault failed to long:', e);
		}

		await delegateActiveUser.fetchAccounts();
		const order = delegateActiveUser.getOrderByUserOrderId(1);
		assert(!order.postOnly);

		// market maker fills vault delegate's long
		const makerOrderParams = getLimitOrderParams({
			marketIndex,
			direction: PositionDirection.SHORT,
			baseAssetAmount,
			price: new BN(initialSolPerpPrice).mul(PRICE_PRECISION),
			userOrderId: 1,
			postOnly: PostOnlyParams.MUST_POST_ONLY,
			immediateOrCancel: true,
		});
		try {
			await makerClient.driftClient.placeAndMakePerpOrder(makerOrderParams, {
				taker: await delegateClient.driftClient.getUserAccountPublicKey(),
				order,
				takerUserAccount: delegateClient.driftClient.getUserAccount(),
				takerStats: delegateClient.driftClient.getUserStatsAccountPublicKey(),
			});
		} catch (e) {
			console.log('maker failed to fill vault:', e);
		}

		// check positions from vault and maker are accurate
		const makerPosition = makerClient.driftClient.getUser().getPerpPosition(0);
		assert(makerPosition.baseAssetAmount.eq(BASE_PRECISION.neg()));
		const vaultPosition = delegateClient.driftClient
			.getUser()
			.getPerpPosition(0);
		assert(vaultPosition.baseAssetAmount.eq(BASE_PRECISION));
	});

	// increase price of SOL perp by 50%
	it('Increase SOL-PERP Price by 50%', async () => {
	  const preOD = adminClient.getOracleDataForPerpMarket(0);
	  const priceBefore = preOD.price.div(PRICE_PRECISION).toNumber();
		assert(priceBefore == initialSolPerpPrice);

	  // increase AMM by 50%
	  await adminClient.moveAmmToPrice(
	    0,
	    new BN(finalSolPerpPrice * PRICE_PRECISION.toNumber())
	  );

		// increase oracle by 50%
		await setFeedPrice(
		anchor.workspace.Pyth,
			finalSolPerpPrice,
			solPerpOracle
		);

		const postOD = adminClient.getOracleDataForPerpMarket(0);
		const priceAfter = postOD.price.div(PRICE_PRECISION).toNumber();
		assert(priceAfter == finalSolPerpPrice);
	});

	// manager exits long for a 50% profit
	it('Short SOL-PERP', async () => {
		const baseAssetAmount = BASE_PRECISION;
		const marketIndex = 0;

		// manager places long order and waits to be filled by the maker
		const takerOrderParams = getLimitOrderParams({
			marketIndex,
			direction: PositionDirection.SHORT,
			baseAssetAmount,
			price: new BN(finalSolPerpPrice - 1).mul(PRICE_PRECISION),
			auctionStartPrice: new BN(finalSolPerpPrice).mul(PRICE_PRECISION),
			auctionEndPrice: new BN(finalSolPerpPrice - 1).mul(PRICE_PRECISION),
			auctionDuration: 10,
			userOrderId: 1,
			postOnly: PostOnlyParams.NONE,
		});
		await delegateClient.driftClient.placePerpOrder(takerOrderParams);
		const delegateUser = delegateClient.driftClient.getUser(0, vault);
		await delegateUser.fetchAccounts();
		const order = delegateUser.getOrderByUserOrderId(1);
		assert(!order.postOnly);

		// market maker fills manager's long
		const makerOrderParams = getLimitOrderParams({
			marketIndex,
			direction: PositionDirection.LONG,
			baseAssetAmount,
			price: new BN(finalSolPerpPrice).mul(PRICE_PRECISION),
			userOrderId: 1,
			postOnly: PostOnlyParams.MUST_POST_ONLY,
			immediateOrCancel: true,
		});
		await makerClient.driftClient.placeAndMakePerpOrder(makerOrderParams, {
			taker: await delegateClient.driftClient.getUserAccountPublicKey(),
			order,
			takerUserAccount: delegateClient.driftClient.getUserAccount(),
			takerStats: delegateClient.driftClient.getUserStatsAccountPublicKey(),
		});

		const makerPosition = makerClient.driftClient.getUser().getPerpPosition(0);
		assert(makerPosition.baseAssetAmount.eq(ZERO));

		const vaultPosition = delegateClient.driftClient
			.getUser()
			.getPerpPosition(0);
		assert(vaultPosition.baseAssetAmount.eq(ZERO));
	});

	it('Withdraw', async () => {
	  const vaultAccount = await program.account.vault.fetch(vault);
	  const vaultDepositor = getVaultDepositorAddressSync(
	    program.programId,
	    vault,
	    vd.publicKey
	  );
	  const remainingAccounts = managerClient.driftClient.getRemainingAccounts({
	    userAccounts: [],
	    writableSpotMarketIndexes: [0],
	  });
		const vaultProtocol = getVaultProtocolAddressSync(
			managerClient.program.programId,
			vault
		);
		remainingAccounts.push({
			pubkey: vaultProtocol,
			isSigner: false,
			isWritable: true,
		});

	  const vaultDepositorAccount = await program.account.vaultDepositor.fetch(vaultDepositor);
	  assert(vaultDepositorAccount.lastWithdrawRequest.value.eq(new BN(0)));
		// $100 initial deposit = 100_000_000 shares
	  assert(vaultDepositorAccount.vaultShares.eq(new BN(100_000_000)));

		await vdClient.requestWithdraw(
			vaultDepositor,
			usdcAmount,
			WithdrawUnit.TOKEN
		);

	  const vaultDepositorAccountAfter =
	    await program.account.vaultDepositor.fetch(vaultDepositor);
	  assert(vaultDepositorAccountAfter.vaultShares.eq(new BN(100_000_000)));
		console.log('withdraw shares:', vaultDepositorAccountAfter.lastWithdrawRequest.shares.toNumber());
		console.log('withdraw value:', vaultDepositorAccountAfter.lastWithdrawRequest.value.toNumber());
		assert(
	    !vaultDepositorAccountAfter.lastWithdrawRequest.shares.eq(new BN(0))
	  );
	  assert(!vaultDepositorAccountAfter.lastWithdrawRequest.value.eq(new BN(0)));

		const vdAcct =
			await program.account.vaultDepositor.fetch(vaultDepositor);
		assert(vdAcct.vault.equals(vault));

	  // do withdraw
	  try {
			// this is done manually because vaultClient.withdraw(vaultDepositor) would use the USDC
			// associated token account as opposed to the keypair we generated to serve as a USDC token account.
	    const txSig = await vdClient.program.methods
	      .withdraw()
	      .accounts({
	        userTokenAccount: vdUserUSDCAccount.publicKey,
	        vault,
	        vaultDepositor,
	        vaultTokenAccount: vaultAccount.tokenAccount,
	        driftUser: vaultAccount.user,
	        driftUserStats: vaultAccount.userStats,
	        driftState: await vdClient.driftClient.getStatePublicKey(),
	        driftSpotMarketVault: vdClient.driftClient.getSpotMarketAccount(0).vault,
	        driftSigner: vdClient.driftClient.getStateAccount().signer,
	        driftProgram: vdClient.driftClient.program.programId,
	      })
	      .remainingAccounts(remainingAccounts)
	      .rpc();

	    await printTxLogs(provider.connection, txSig);
	  } catch (e) {
	    console.error(e);
	  }
	});
});
