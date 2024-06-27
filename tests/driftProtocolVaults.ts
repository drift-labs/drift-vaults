import * as anchor from '@coral-xyz/anchor';
import { AnchorProvider, Program } from '@coral-xyz/anchor';
import {
	AdminClient,
	BN,
	BulkAccountLoader,
	DriftClient,
	ZERO,
	PRICE_PRECISION,
	decodeName,
	EventSubscriber,
	User,
	OracleSource,
	PEG_PRECISION,
	Wallet,
	PublicKey,
	ContractTier,
	BASE_PRECISION,
	ONE,
	DEFAULT_MARKET_NAME,
	getDriftStateAccountPublicKeyAndNonce,
	DRIFT_PROGRAM_ID,
	TestClient,
} from '@drift-labs/sdk';
import {
	createUserWithUSDCAccount,
	initializeQuoteSpotMarket,
	mockOracle,
	mockUSDCMint,
	mockUserUSDCAccount,
	printTxLogs,
	sleep,
} from './testHelpers';
import {
	AddressLookupTableAccount,
	BlockhashWithExpiryBlockHeight,
	Keypair,
	SYSVAR_RENT_PUBKEY,
	Transaction,
	TransactionInstruction,
	TransactionVersion,
	VersionedTransaction,
} from '@solana/web3.js';
import { assert } from 'chai';
import {
	VaultClient,
	getVaultAddressSync,
	getVaultDepositorAddressSync,
	WithdrawUnit,
	encodeName,
	DriftVaults,
	VaultProtocolParams,
	getVaultProtocolAddressSync,
	IDL,
} from '../ts/sdk';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';

describe('driftProtocolVaults', () => {
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

	const vaultClient = new VaultClient({
		driftClient: adminClient,
		program: program,
		cliMode: true,
	});

	const manager = Keypair.generate();
	let managerDriftClient: DriftClient;
	let managerUser: User;
	let managerUSDCAccount: Keypair;

	const maker = Keypair.generate();
	let makerDriftClient: DriftClient;
	let makerUser: User;
	let makerUSDCAccount: Keypair;

	const vd = Keypair.generate();
	let vdDriftClient: DriftClient;
	let vdUser: User;
	let vdUSDCAccount: Keypair;
	let vdVaultClient: VaultClient;

	// ammInvariant == k == x * y
	const mantissaSqrtScale = new BN(Math.sqrt(PRICE_PRECISION.toNumber()));
	const ammInitialQuoteAssetReserve = new BN(5 * 10 ** 13).mul(
		mantissaSqrtScale
	);
	const ammInitialBaseAssetReserve = new BN(5 * 10 ** 13).mul(
		mantissaSqrtScale
	);

	let usdcMint: Keypair;

	const protocol = Keypair.generate().publicKey;
	const vaultName = 'protocol vault';
	const vault = getVaultAddressSync(program.programId, encodeName(vaultName));

	const usdcAmount = new BN(100 * 10 ** 6);

	const VAULT_PROTOCOL_DISCRIM: number[] = [106, 130, 5, 195, 126, 82, 249, 53];

	before(async () => {
		// init USDC spot market
		usdcMint = await mockUSDCMint(provider);

		// define oracle for SOL perp market
		const solUsd = await mockOracle(32.821);
		const marketIndexes = [0];
		const spotMarketIndexes = [0, 1];
		const oracleInfos = [{ publicKey: solUsd, source: OracleSource.PYTH }];

		const setupClient = new AdminClient({
			connection,
			wallet: provider.wallet,
			opts: {
				commitment: 'confirmed',
			},
			activeSubAccountId: 0,
			perpMarketIndexes: marketIndexes,
			spotMarketIndexes: spotMarketIndexes,
			oracleInfos,
			accountSubscription: {
				type: 'polling',
				accountLoader: bulkAccountLoader,
			},
		});

		await setupClient.initialize(usdcMint.publicKey, true);
		console.log('init admin client');
		await setupClient.subscribe();
		await initializeQuoteSpotMarket(setupClient, usdcMint.publicKey);
		console.log('init USDC spot market');

		await setupClient.initializePerpMarket(
			0,
			solUsd,
			ammInitialBaseAssetReserve,
			ammInitialQuoteAssetReserve,
			new BN(0),
			new BN(32 * PEG_PRECISION.toNumber())
		);
		console.log('init SOL perp market');
		await setupClient.unsubscribe();

		// init manager user to trade SOL perp market
		await provider.connection.requestAirdrop(manager.publicKey, 10 ** 9);
		await sleep(1000);
		managerDriftClient = new DriftClient({
			connection,
			wallet: new Wallet(manager),
			opts: {
				commitment: 'confirmed',
			},
			activeSubAccountId: 0,
			perpMarketIndexes: marketIndexes,
			spotMarketIndexes: spotMarketIndexes,
			oracleInfos,
			accountSubscription: {
				type: 'websocket',
				resubTimeoutMs: 30_000,
			},
		});
		managerUSDCAccount = await mockUserUSDCAccount(
			usdcMint,
			usdcAmount,
			provider,
			manager.publicKey
		);
		await managerDriftClient.subscribe();
		await managerDriftClient.initializeUserAccountAndDepositCollateral(
			usdcAmount,
			managerUSDCAccount.publicKey
		);
		managerUser = new User({
			driftClient: managerDriftClient,
			userAccountPublicKey: await managerDriftClient.getUserAccountPublicKey(),
		});
		await managerUser.subscribe();

		// init a market maker for manager to trade against
		await provider.connection.requestAirdrop(maker.publicKey, 10 ** 9);
		await sleep(1000);
		makerUSDCAccount = await mockUserUSDCAccount(
			usdcMint,
			usdcAmount,
			provider,
			maker.publicKey
		);
		makerDriftClient = new DriftClient({
			connection,
			wallet: new Wallet(maker),
			opts: {
				commitment: 'confirmed',
			},
			activeSubAccountId: 0,
			perpMarketIndexes: marketIndexes,
			spotMarketIndexes: spotMarketIndexes,
			oracleInfos,
			userStats: true,
			accountSubscription: {
				type: 'websocket',
				resubTimeoutMs: 30_000,
			},
		});
		await makerDriftClient.subscribe();
		await makerDriftClient.initializeUserAccountAndDepositCollateral(
			usdcAmount,
			makerUSDCAccount.publicKey
		);
		makerUser = new User({
			driftClient: makerDriftClient,
			userAccountPublicKey: await makerDriftClient.getUserAccountPublicKey(),
		});
		await makerUser.subscribe();

		// init VaultDepositor for manager to trade on behalf of
		await provider.connection.requestAirdrop(vd.publicKey, 10 ** 9);
		await sleep(1000);
		vdUSDCAccount = await mockUserUSDCAccount(
			usdcMint,
			usdcAmount,
			provider,
			vd.publicKey
		);
		vdDriftClient = new DriftClient({
			connection,
			wallet: new Wallet(vd),
			opts: {
				commitment: 'confirmed',
			},
			activeSubAccountId: 0,
			perpMarketIndexes: marketIndexes,
			spotMarketIndexes: spotMarketIndexes,
			oracleInfos,
			userStats: true,
			accountSubscription: {
				type: 'websocket',
				resubTimeoutMs: 30_000,
			},
		});
		await vdDriftClient.subscribe();
		await vdDriftClient.initializeUserAccountAndDepositCollateral(
			usdcAmount,
			vdUSDCAccount.publicKey
		);
		vdUser = new User({
			driftClient: vdDriftClient,
			userAccountPublicKey: await vdDriftClient.getUserAccountPublicKey(),
		});
		await vdUser.subscribe();

		// authority of VaultDepositor must be payer,
		// so we need a new VaultClient made with the VaultDepositor's DriftClient
		const vdWallet = new anchor.Wallet(vd);
		const vdProvider = new anchor.AnchorProvider(
			provider.connection,
			vdWallet,
			{
				preflightCommitment: 'confirmed',
				skipPreflight: false,
				commitment: 'confirmed',
			}
		);
		vdVaultClient = new VaultClient({
			driftClient: vdDriftClient,
			program: new Program(IDL, program.programId, vdProvider),
			cliMode: true,
		});

		// start account loader
		bulkAccountLoader.startPolling();
		await bulkAccountLoader.load();
		await adminClient.subscribe();
	});

	after(async () => {
		await managerDriftClient.unsubscribe();
		await makerDriftClient.unsubscribe();
		await vdDriftClient.unsubscribe();
		await adminClient.unsubscribe();

		await managerUser.unsubscribe();
		await vdUser.unsubscribe();
		await makerUser.unsubscribe();

		bulkAccountLoader.stopPolling();
	});

	it('Initialize Protocol Vault', async () => {
		const vpParams: VaultProtocolParams = {
			protocol,
			protocolFee: new BN(0),
			protocolProfitShare: 0,
		};
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
			vaultProtocol: vpParams,
		});
		const vaultAcct = await program.account.vault.fetch(vault);
		const vp = getVaultProtocolAddressSync(program.programId, vault);
		// asserts "exit" was called on VaultProtocol to define the discriminator
		const vpAcctInfo = await connection.getAccountInfo(vp);
		assert(vpAcctInfo.data.includes(Buffer.from(VAULT_PROTOCOL_DISCRIM)));

		// asserts Vault and VaultProtocol fields were set properly
		const vpAcct = await program.account.vaultProtocol.fetch(vp);
		assert(vaultAcct.vaultProtocol.equals(vp));
		assert(vpAcct.protocol.equals(protocol));
	});

	it('Initialize Vault Depositor', async () => {
		await vdVaultClient.initializeVaultDepositor(vault, vd.publicKey);
		const vdKey = getVaultDepositorAddressSync(
			program.programId,
			vault,
			vd.publicKey
		);
		const vdAcct = await program.account.vaultDepositor.fetch(vdKey);
		assert(vdAcct.vault.equals(vault));
	});

	// // vault depositor deposits USDC to the vault's token account
	// it('Vault Depositor Deposit', async () => {
	//   const vaultAccount = await program.account.vault.fetch(vault);
	//   const vaultDepositor = getVaultDepositorAddressSync(
	//     program.programId,
	//     vault,
	//     vd.publicKey
	//   );
	//   const remainingAccounts = adminClient.getRemainingAccounts({
	//     userAccounts: [],
	//     writableSpotMarketIndexes: [0],
	//   });
	//
	//   const txSig = await program.methods
	//     .deposit(usdcAmount)
	//     .accounts({
	//       userTokenAccount: vdUSDCAccount.publicKey,
	//       vault,
	//       vaultDepositor,
	//       vaultTokenAccount: vaultAccount.tokenAccount,
	//       driftUser: vaultAccount.user,
	//       driftUserStats: vaultAccount.userStats,
	//       driftState: await adminClient.getStatePublicKey(),
	//       driftSpotMarketVault: adminClient.getSpotMarketAccount(0).vault,
	//       driftProgram: adminClient.program.programId,
	//     })
	//     .remainingAccounts(remainingAccounts)
	//     .rpc();
	//
	//   await printTxLogs(provider.connection, txSig);
	// });
	//
	// // todo: increase price of SOL perp market to simulate profitable trade
	// //  use adminClient.moveAmmToPrice to simulate profitable trade to test the ability of the user, manager, and
	// //  protocol to withdraw profit shares.
	// it('Increase SOL-PERP Price', async () => {
	//   const sm = adminClient.getSpotMarketAccount(0);
	//   const od = adminClient.getOracleDataForSpotMarket(0);
	//   const priceBefore = od.price.div(PRICE_PRECISION).toNumber();
	//   const name = decodeName(sm.name);
	//   console.log(`${name} price before: ${priceBefore}`);
	//   // SOL perp market sees 50% price increase
	//   const txSig = await adminClient.moveAmmToPrice(
	//     0,
	//     new BN(150.0 * PRICE_PRECISION.toNumber())
	//   );
	//   await printTxLogs(provider.connection, txSig);
	// });
	//
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
	//   console.log(
	//     'vaultDepositorAccount.vaultShares:',
	//     vaultDepositorAccount.vaultShares.toString()
	//   );
	//   assert(vaultDepositorAccount.vaultShares.eq(new BN(1_000_000_000)));
	//
	//   // request withdraw
	//   console.log('request withdraw');
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
	//
	//   await printTxLogs(provider.connection, requestTxSig);
	//
	//   const vaultDepositorAccountAfter =
	//     await program.account.vaultDepositor.fetch(vaultDepositor);
	//   assert(vaultDepositorAccountAfter.vaultShares.eq(new BN(1_000_000_000)));
	//   console.log(
	//     'vaultDepositorAccountAfter.lastWithdrawRequestShares:',
	//     vaultDepositorAccountAfter.lastWithdrawRequest.shares.toString()
	//   );
	//   assert(
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
	//         userTokenAccount: userUSDCAccount.publicKey,
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
