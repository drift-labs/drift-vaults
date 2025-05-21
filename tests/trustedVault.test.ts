import * as anchor from '@coral-xyz/anchor';
import { BN, Program, Wallet } from '@coral-xyz/anchor';
import { describe, it } from '@jest/globals';
import {
	BankrunContextWrapper,
	TEST_ADMIN_KEYPAIR,
} from './common/bankrunConnection';
import { startAnchor } from 'solana-bankrun';
import {
	VaultClient,
	getVaultAddressSync,
	getVaultDepositorAddressSync,
	encodeName,
	DriftVaults,
	VAULT_PROGRAM_ID,
	IDL,
} from '../ts/sdk/lib';
import {
	BulkAccountLoader,
	DRIFT_PROGRAM_ID,
	DriftClient,
	getUserStatsAccountPublicKey,
	getVariant,
	OracleSource,
	PEG_PRECISION,
	PublicKey,
	QUOTE_PRECISION,
	TestClient,
	ZERO,
} from '@drift-labs/sdk';
import { TestBulkAccountLoader } from './common/testBulkAccountLoader';
import {
	bootstrapSignerClientAndUserBankrun,
	initializeQuoteSpotMarket,
	initializeSolSpotMarket,
	mockUSDCMintBankrun,
	printTxLogs,
} from './common/testHelpers';
import { Keypair, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { mockOracleNoProgram } from './common/bankrunOracle';
import { BankrunProvider } from 'anchor-bankrun';
import { VaultClass } from '../ts/sdk/src';

// ammInvariant == k == x * y
const mantissaSqrtScale = new BN(100_000);
const ammInitialQuoteAssetReserve = new BN(5 * 10 ** 13).mul(mantissaSqrtScale);
const ammInitialBaseAssetReserve = new BN(5 * 10 ** 13).mul(mantissaSqrtScale);

describe('TestTrustedVault', () => {
	let vaultProgram: Program<DriftVaults>;
	const initialSolPerpPrice = 100;
	let adminDriftClient: TestClient;
	let bulkAccountLoader: TestBulkAccountLoader;
	let bankrunContextWrapper: BankrunContextWrapper;
	let usdcMint: PublicKey;
	let solPerpOracle: PublicKey;
	const vaultName = 'fuel distribution vault';
	const commonVaultKey = getVaultAddressSync(
		VAULT_PROGRAM_ID,
		encodeName(vaultName)
	);
	let vaultUserStatsKey: PublicKey;
	const usdcAmount = new BN(1_000_000_000).mul(QUOTE_PRECISION);

	const managerSigner = Keypair.generate();
	let managerClient: VaultClient;
	let managerDriftClient: DriftClient;

	let adminClient: VaultClient;

	const user1Signer = Keypair.generate();
	let user1Client: VaultClient;
	let user1DriftClient: DriftClient;
	let user1UserUSDCAccount: PublicKey;
	let user1VaultDepositor: PublicKey;

	beforeEach(async () => {
		const context = await startAnchor(
			'',
			[
				{
					name: 'drift',
					programId: new PublicKey(
						'dRiftyHA39MWEi3m9aunc5MzRF1JYuBsbn6VPcn33UH'
					),
				},
			],
			[]
		);

		// wrap the context to use it with the test helpers
		bankrunContextWrapper = new BankrunContextWrapper(context);

		vaultProgram = new Program<DriftVaults>(
			IDL,
			VAULT_PROGRAM_ID,
			bankrunContextWrapper.provider
		);

		bulkAccountLoader = new TestBulkAccountLoader(
			bankrunContextWrapper.connection.toConnection(),
			'processed',
			1
		);

		usdcMint = await mockUSDCMintBankrun(bankrunContextWrapper);

		solPerpOracle = await mockOracleNoProgram(
			bankrunContextWrapper,
			initialSolPerpPrice
		);

		const adminWallet = new Wallet(
			Keypair.fromSecretKey(Buffer.from(TEST_ADMIN_KEYPAIR))
		);

		await bankrunContextWrapper.fundKeypair(
			adminWallet.payer,
			100 * LAMPORTS_PER_SOL
		);

		adminDriftClient = new TestClient({
			connection: bankrunContextWrapper.connection.toConnection(),
			wallet: adminWallet,
			programID: new PublicKey(DRIFT_PROGRAM_ID),
			opts: {
				commitment: 'confirmed',
			},
			activeSubAccountId: 0,
			perpMarketIndexes: [0],
			spotMarketIndexes: [0, 1],
			subAccountIds: [],
			oracleInfos: [{ publicKey: solPerpOracle, source: OracleSource.PYTH }],
			accountSubscription: {
				type: 'polling',
				accountLoader: bulkAccountLoader as BulkAccountLoader,
			},
		});

		await adminDriftClient.initialize(usdcMint, true);
		await adminDriftClient.subscribe();

		await initializeQuoteSpotMarket(adminDriftClient, usdcMint);
		await initializeSolSpotMarket(adminDriftClient, solPerpOracle);

		await adminDriftClient.initializePerpMarket(
			0,
			solPerpOracle,
			ammInitialBaseAssetReserve,
			ammInitialQuoteAssetReserve,
			new BN(0), // 1 HOUR
			new BN(initialSolPerpPrice).mul(PEG_PRECISION)
		);

		await adminDriftClient.fetchAccounts();

		const managerBootstrap = await bootstrapSignerClientAndUserBankrun({
			bankrunContext: bankrunContextWrapper,
			programId: VAULT_PROGRAM_ID,
			signer: managerSigner,
			usdcMint: usdcMint,
			usdcAmount,
			vaultClientCliMode: true,
			driftClientConfig: {
				accountSubscription: {
					type: 'polling',
					accountLoader: bulkAccountLoader as BulkAccountLoader,
				},
				activeSubAccountId: 0,
				subAccountIds: [],
				perpMarketIndexes: [0],
				spotMarketIndexes: [0, 1],
				oracleInfos: [{ publicKey: solPerpOracle, source: OracleSource.PYTH }],
			},
		});
		managerClient = managerBootstrap.vaultClient;
		managerDriftClient = managerBootstrap.driftClient;

		vaultUserStatsKey = getUserStatsAccountPublicKey(
			managerDriftClient.program.programId,
			commonVaultKey
		);

		const provider = new BankrunProvider(
			bankrunContextWrapper.context,
			adminDriftClient.wallet as anchor.Wallet
		);
		const program = new Program(IDL, VAULT_PROGRAM_ID, provider);
		adminClient = new VaultClient({
			driftClient: adminDriftClient,
			// @ts-ignore
			program,
		});

		const user1Bootstrap = await bootstrapSignerClientAndUserBankrun({
			bankrunContext: bankrunContextWrapper,
			programId: VAULT_PROGRAM_ID,
			signer: user1Signer,
			usdcMint: usdcMint,
			usdcAmount,
			vaultClientCliMode: true,
			driftClientConfig: {
				accountSubscription: {
					type: 'polling',
					accountLoader: bulkAccountLoader as BulkAccountLoader,
				},
				activeSubAccountId: 0,
				subAccountIds: [],
				perpMarketIndexes: [0],
				spotMarketIndexes: [0, 1],
				oracleInfos: [{ publicKey: solPerpOracle, source: OracleSource.PYTH }],
			},
		});
		user1Client = user1Bootstrap.vaultClient;
		user1DriftClient = user1Bootstrap.driftClient;
		user1UserUSDCAccount = user1Bootstrap.userUSDCAccount.publicKey;
		user1VaultDepositor = getVaultDepositorAddressSync(
			vaultProgram.programId,
			commonVaultKey,
			user1Signer.publicKey
		);

		// initialize a vault and depositors
		await managerClient.initializeVault(
			{
				name: encodeName(vaultName),
				spotMarketIndex: 0,
				redeemPeriod: ZERO,
				maxTokens: ZERO,
				managementFee: ZERO,
				profitShare: 0,
				hurdleRate: 0,
				permissioned: false,
				minDepositAmount: ZERO,
			},
			{ noLut: true }
		);
		await user1Client.initializeVaultDepositor(
			commonVaultKey,
			user1Signer.publicKey,
			user1Signer.publicKey,
			{ noLut: true }
		);
	});

	afterEach(async () => {
		await adminDriftClient.unsubscribe();
		await adminClient.unsubscribe();
		await managerClient.unsubscribe();
		await managerDriftClient.unsubscribe();
		await user1Client.unsubscribe();
		await user1DriftClient.unsubscribe();
	});

	it('vaults initialized', async () => {
		const vaultAcct = await vaultProgram.account.vault.fetch(commonVaultKey);
		expect(vaultAcct.manager).toEqual(managerSigner.publicKey);

		expect(getVariant(vaultAcct.vaultClass)).toEqual('normal');

		const vaultDepositor = getVaultDepositorAddressSync(
			vaultProgram.programId,
			commonVaultKey,
			user1Signer.publicKey
		);
		const vdAcct = await vaultProgram.account.vaultDepositor.fetch(
			vaultDepositor
		);
		expect(vdAcct.vault).toEqual(commonVaultKey);
	});

	it('admin can update vault class and borrow and repay', async () => {
		let vaultAcct = await vaultProgram.account.vault.fetch(commonVaultKey);
		expect(vaultAcct.manager).toEqual(managerSigner.publicKey);
		expect(getVariant(vaultAcct.vaultClass)).toEqual('normal');

		await adminClient.updateMarginTradingEnabled(commonVaultKey, true, {
			noLut: true,
		});

		await adminClient.adminUpdateVaultClass(
			commonVaultKey,
			VaultClass.TRUSTED,
			{ noLut: true }
		);

		vaultAcct = await vaultProgram.account.vault.fetch(commonVaultKey);
		expect(getVariant(vaultAcct.vaultClass)).toEqual('trusted');

		// user1 deposit sol into drift (for vault to borrow)
		await bankrunContextWrapper.fundKeypair(
			user1Signer,
			100 * LAMPORTS_PER_SOL
		);
		const dep = await user1DriftClient.deposit(
			new BN(100 * LAMPORTS_PER_SOL),
			1,
			user1Signer.publicKey,
			undefined,
			undefined
		);
		await printTxLogs(
			bankrunContextWrapper.connection.toConnection(),
			dep,
			false,
			user1DriftClient.program
		);

		// user1 deposits usdcAmount into vault
		await user1Client.deposit(
			user1VaultDepositor,
			usdcAmount,
			undefined,
			{ noLut: true },
			user1UserUSDCAccount
		);

		const vaultEquity = await adminClient.calculateVaultEquity({
			address: commonVaultKey,
		});
		expect(vaultEquity.toString()).toEqual(usdcAmount.toString());

		await adminDriftClient.fetchAccounts();
		const spotMarket1 = adminDriftClient.getSpotMarketAccount(1);
		expect(spotMarket1!.depositBalance.toNumber()).toEqual(
			100 * LAMPORTS_PER_SOL
		);

		const managerSOLBalance0 =
			await bankrunContextWrapper.connection.getBalance(
				managerSigner.publicKey
			);

		const b = await managerClient.managerBorrow(
			commonVaultKey,
			1,
			new BN(50 * LAMPORTS_PER_SOL),
			undefined,
			{ noLut: true, cuPriceMicroLamports: 0 }
		);
		const e = await printTxLogs(
			bankrunContextWrapper.connection.toConnection(),
			b,
			false,
			// @ts-ignore
			adminClient.program
		);
		expect(e.length).toEqual(1);
		expect((e[0].data.borrowAmount as BN).toNumber()).toEqual(
			50 * LAMPORTS_PER_SOL
		);
		expect((e[0].data.borrowValue as BN).toNumber()).toEqual(5000 * 1e6);
		expect(e[0].data.borrowSpotMarketIndex).toEqual(1);
		expect(e[0].data.spotMarketIndex).toEqual(0);

		const managerSOLBalance1 =
			await bankrunContextWrapper.connection.getBalance(
				managerSigner.publicKey
			);

		await adminDriftClient.fetchAccounts();
		const spotMarket11 = adminDriftClient.getSpotMarketAccount(1);
		expect(spotMarket11!.borrowBalance.toNumber()).toBeCloseTo(
			50 * LAMPORTS_PER_SOL,
			-1
		);
		expect(
			(Number(managerSOLBalance1) - Number(managerSOLBalance0)) /
				LAMPORTS_PER_SOL
		).toBeCloseTo(50, 2);

		vaultAcct = await vaultProgram.account.vault.fetch(commonVaultKey);
		expect(vaultAcct.managerBorrowedValue.toNumber()).toEqual(5000 * 1e6);
	});
});
