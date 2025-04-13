import * as anchor from '@coral-xyz/anchor';
import { BN, Program, Wallet } from '@coral-xyz/anchor';
import { describe, it } from '@jest/globals';
import { BankrunContextWrapper } from './common/bankrunConnection';
import { startAnchor } from 'solana-bankrun';
import {
	VaultClient,
	getVaultAddressSync,
	getVaultDepositorAddressSync,
	encodeName,
	DriftVaults,
	VAULT_PROGRAM_ID,
	IDL,
	VaultDepositor,
	WithdrawUnit,
	Vault,
	FeeUpdateStatus,
	getFeeUpdateAddressSync,
} from '../ts/sdk/lib';
import {
	BulkAccountLoader,
	DRIFT_PROGRAM_ID,
	DriftClient,
	getUserStatsAccountPublicKey,
	getVariant,
	OracleSource,
	PEG_PRECISION,
	PERCENTAGE_PRECISION,
	PublicKey,
	QUOTE_PRECISION,
	TestClient,
	User,
	ZERO,
} from '@drift-labs/sdk';
import { TestBulkAccountLoader } from './common/testBulkAccountLoader';
import {
	assert,
	bootstrapSignerClientAndUserBankrun,
	initializeQuoteSpotMarket,
	initializeSolSpotMarket,
	mockUSDCMintBankrun,
	printTxLogs,
} from './common/testHelpers';
import {
	getUserStatsDecoded,
	overWriteUserStatsFuel,
	getVaultDepositorDecoded,
	getVaultDecoded,
	overWriteVaultDepositor,
	overWriteVault,
	createVaultWithFuelOverflow,
	overWriteUserStats,
} from './common/bankrunHelpers';
import {
	Keypair,
	TransactionInstruction,
	TransactionMessage,
	VersionedTransaction,
} from '@solana/web3.js';
import { mockOracleNoProgram } from './common/bankrunOracle';
import { BankrunProvider } from 'anchor-bankrun';

// ammInvariant == k == x * y
const mantissaSqrtScale = new BN(100_000);
const ammInitialQuoteAssetReserve = new BN(5 * 10 ** 13).mul(mantissaSqrtScale);
const ammInitialBaseAssetReserve = new BN(5 * 10 ** 13).mul(mantissaSqrtScale);

const redeemPeriod = new BN(1);

const TEN_PCT_MANAGEMENT_FEE = new BN(PERCENTAGE_PRECISION.divn(10));
const TWENTY_PCT_MANAGEMENT_FEE = new BN(PERCENTAGE_PRECISION.divn(5));
const FIFTY_PCT_MANAGEMENT_FEE = new BN(PERCENTAGE_PRECISION.divn(2));
const ONE_DAY_S = new BN(86400);

describe('feeUpdate', () => {
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

	const user2Signer = Keypair.generate();
	let user2Client: VaultClient;
	let user2DriftClient: DriftClient;
	let user2UserUSDCAccount: PublicKey;
	let user2VaultDepositor: PublicKey;

	const user3Signer = Keypair.generate();
	let user3Client: VaultClient;
	let user3DriftClient: DriftClient;
	let user3UserUSDCAccount: PublicKey;
	let user3VaultDepositor: PublicKey;

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

		adminDriftClient = new TestClient({
			connection: bankrunContextWrapper.connection.toConnection(),
			wallet: bankrunContextWrapper.provider.wallet,
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

		const user2Bootstrap = await bootstrapSignerClientAndUserBankrun({
			bankrunContext: bankrunContextWrapper,
			programId: VAULT_PROGRAM_ID,
			signer: user2Signer,
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
		user2Client = user2Bootstrap.vaultClient;
		user2DriftClient = user2Bootstrap.driftClient;
		user2UserUSDCAccount = user2Bootstrap.userUSDCAccount.publicKey;
		user2VaultDepositor = getVaultDepositorAddressSync(
			vaultProgram.programId,
			commonVaultKey,
			user2Signer.publicKey
		);

		const user3Bootstrap = await bootstrapSignerClientAndUserBankrun({
			bankrunContext: bankrunContextWrapper,
			programId: VAULT_PROGRAM_ID,
			signer: user3Signer,
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
		user3Client = user3Bootstrap.vaultClient;
		user3DriftClient = user3Bootstrap.driftClient;
		user3UserUSDCAccount = user3Bootstrap.userUSDCAccount.publicKey;
		user3VaultDepositor = getVaultDepositorAddressSync(
			vaultProgram.programId,
			commonVaultKey,
			user3Signer.publicKey
		);

		// initialize a vault and depositors
		await managerClient.initializeVault(
			{
				name: encodeName(vaultName),
				spotMarketIndex: 0,
				redeemPeriod,
				maxTokens: ZERO,
				managementFee: TWENTY_PCT_MANAGEMENT_FEE,
				profitShare: TWENTY_PCT_MANAGEMENT_FEE.toNumber(),
				hurdleRate: TEN_PCT_MANAGEMENT_FEE.toNumber(),
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
		await user2Client.initializeVaultDepositor(
			commonVaultKey,
			user2Signer.publicKey,
			user2Signer.publicKey,
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
		await user2Client.unsubscribe();
		await user2DriftClient.unsubscribe();
		await user3Client.unsubscribe();
		await user3DriftClient.unsubscribe();
	});

	it('vaults initialized', async () => {
		const vaultAcct = await vaultProgram.account.vault.fetch(commonVaultKey);
		expect(vaultAcct.manager).toEqual(managerSigner.publicKey);

		const vaultDepositor = getVaultDepositorAddressSync(
			vaultProgram.programId,
			commonVaultKey,
			user2Signer.publicKey
		);
		const vdAcct = await vaultProgram.account.vaultDepositor.fetch(
			vaultDepositor
		);
		expect(vdAcct.vault).toEqual(commonVaultKey);

		const vaultDepositor2 = getVaultDepositorAddressSync(
			vaultProgram.programId,
			commonVaultKey,
			user1Signer.publicKey
		);
		const vdAcct2 = await vaultProgram.account.vaultDepositor.fetch(
			vaultDepositor2
		);
		expect(vdAcct2.vault).toEqual(commonVaultKey);
	});

	it('manager can init fee update account', async () => {
		let vaultAcct = await vaultProgram.account.vault.fetch(commonVaultKey);
		expect(vaultAcct.feeUpdateStatus).toEqual(FeeUpdateStatus.None);

		const feeUpdate = getFeeUpdateAddressSync(
			vaultProgram.programId,
			commonVaultKey
		);
		expect(
			await bankrunContextWrapper.connection.getAccountInfo(feeUpdate)
		).toBeNull();

		await managerClient.managerInitFeeUpdate(commonVaultKey, { noLut: true });

		vaultAcct = await vaultProgram.account.vault.fetch(commonVaultKey);
		expect(vaultAcct.feeUpdateStatus).toEqual(FeeUpdateStatus.HasFeeUpdate);

		expect(
			await bankrunContextWrapper.connection.getAccountInfo(feeUpdate)
		).not.toBeNull();
	});

	it('manager can lower fee from normal update', async () => {
		let vaultAcct = await vaultProgram.account.vault.fetch(commonVaultKey);
		expect(vaultAcct.managementFee.toNumber()).toEqual(
			TWENTY_PCT_MANAGEMENT_FEE.toNumber()
		);
		expect(vaultAcct.profitShare).toEqual(TWENTY_PCT_MANAGEMENT_FEE.toNumber());
		expect(vaultAcct.hurdleRate).toEqual(TEN_PCT_MANAGEMENT_FEE.toNumber());

		await managerClient.managerUpdateVault(
			commonVaultKey,
			{
				redeemPeriod: null,
				maxTokens: null,
				minDepositAmount: null,
				permissioned: null,
				managementFee: TEN_PCT_MANAGEMENT_FEE,
				profitShare: TEN_PCT_MANAGEMENT_FEE.toNumber(),
				hurdleRate: TWENTY_PCT_MANAGEMENT_FEE.toNumber(),
			},
			{ noLut: true }
		);

		vaultAcct = await vaultProgram.account.vault.fetch(commonVaultKey);
		expect(vaultAcct.managementFee.toNumber()).toEqual(
			TEN_PCT_MANAGEMENT_FEE.toNumber()
		);
		expect(vaultAcct.profitShare).toEqual(TEN_PCT_MANAGEMENT_FEE.toNumber());
		expect(vaultAcct.hurdleRate).toEqual(TWENTY_PCT_MANAGEMENT_FEE.toNumber());
	});

	it('manager cannot raise fee from normal update', async () => {
		let vaultAcct = await vaultProgram.account.vault.fetch(commonVaultKey);
		expect(vaultAcct.managementFee.toNumber()).toEqual(
			TWENTY_PCT_MANAGEMENT_FEE.toNumber()
		);
		expect(vaultAcct.profitShare).toEqual(TWENTY_PCT_MANAGEMENT_FEE.toNumber());
		expect(vaultAcct.hurdleRate).toEqual(TEN_PCT_MANAGEMENT_FEE.toNumber());

		try {
			await managerClient.managerUpdateVault(
				commonVaultKey,
				{
					redeemPeriod: null,
					maxTokens: null,
					minDepositAmount: null,
					permissioned: null,
					managementFee: FIFTY_PCT_MANAGEMENT_FEE,
					profitShare: FIFTY_PCT_MANAGEMENT_FEE.toNumber(),
					hurdleRate: TEN_PCT_MANAGEMENT_FEE.toNumber(),
				},
				{ noLut: true }
			);
			fail('should not get here');
		} catch (e) {
			expect(e).toBeDefined();
		}

		vaultAcct = await vaultProgram.account.vault.fetch(commonVaultKey);
		expect(vaultAcct.managementFee.toNumber()).toEqual(
			TWENTY_PCT_MANAGEMENT_FEE.toNumber()
		);
		expect(vaultAcct.profitShare).toEqual(TWENTY_PCT_MANAGEMENT_FEE.toNumber());
		expect(vaultAcct.hurdleRate).toEqual(TEN_PCT_MANAGEMENT_FEE.toNumber());
	});

	it('manager must choose timelock duration greater than redeem period and 1 day', async () => {
		let vaultAcct = await vaultProgram.account.vault.fetch(commonVaultKey);
		expect(vaultAcct.managementFee.toNumber()).toEqual(
			TWENTY_PCT_MANAGEMENT_FEE.toNumber()
		);
		expect(vaultAcct.profitShare).toEqual(TWENTY_PCT_MANAGEMENT_FEE.toNumber());
		expect(vaultAcct.hurdleRate).toEqual(TEN_PCT_MANAGEMENT_FEE.toNumber());

		const timelockDuration = ONE_DAY_S.divn(2);

		try {
			await managerClient.managerUpdateFees(
				commonVaultKey,
				{
					timelockDuration,
					newManagementFee: TEN_PCT_MANAGEMENT_FEE,
					newProfitShare: TEN_PCT_MANAGEMENT_FEE.toNumber(),
					newHurdleRate: TWENTY_PCT_MANAGEMENT_FEE.toNumber(),
				},
				{ noLut: true }
			);
			fail('should not get here');
		} catch (e) {
			expect(e).toBeDefined();
		}
	});

	it('manager can lower fee through timelock', async () => {
		let vaultAcct = await vaultProgram.account.vault.fetch(commonVaultKey);
		expect(vaultAcct.managementFee.toNumber()).toEqual(
			TWENTY_PCT_MANAGEMENT_FEE.toNumber()
		);
		expect(vaultAcct.profitShare).toEqual(TWENTY_PCT_MANAGEMENT_FEE.toNumber());
		expect(vaultAcct.hurdleRate).toEqual(TEN_PCT_MANAGEMENT_FEE.toNumber());

		const timelockDuration = ONE_DAY_S;

		const tx = await managerClient.managerUpdateFees(
			commonVaultKey,
			{
				timelockDuration,
				newManagementFee: TEN_PCT_MANAGEMENT_FEE,
				newProfitShare: TEN_PCT_MANAGEMENT_FEE.toNumber(),
				newHurdleRate: TWENTY_PCT_MANAGEMENT_FEE.toNumber(),
			},
			{ noLut: true }
		);
		const events = await printTxLogs(
			bankrunContextWrapper.connection.toConnection(),
			tx,
			false,
			// @ts-ignore
			vaultProgram
		);

		expect(events.length).toEqual(1);
		expect(getVariant(events[0].data.action)).toEqual('pending');
		const ts = events[0].data.ts;
		const timeLockEndTs = events[0].data.timelockEndTs;
		expect(timeLockEndTs.sub(ts).toNumber()).toEqual(
			timelockDuration.toNumber()
		);

		vaultAcct = await vaultProgram.account.vault.fetch(commonVaultKey);
		expect(vaultAcct.managementFee.toNumber()).toEqual(
			TWENTY_PCT_MANAGEMENT_FEE.toNumber()
		);
		expect(vaultAcct.profitShare).toEqual(TWENTY_PCT_MANAGEMENT_FEE.toNumber());
		expect(vaultAcct.hurdleRate).toEqual(TEN_PCT_MANAGEMENT_FEE.toNumber());

		// user deposits after 1 day, new fee should come into effect
		await bankrunContextWrapper.moveTimeForward(ONE_DAY_S.toNumber());
		const tx1 = await user1Client.deposit(
			user1VaultDepositor,
			usdcAmount,
			undefined,
			{ noLut: true },
			user1UserUSDCAccount
		);
		const events1 = await printTxLogs(
			bankrunContextWrapper.connection.toConnection(),
			tx1,
			false,
			// @ts-ignore
			vaultProgram
		);
		const feeUpdateEvent = events1.find((e) => e.name === 'FeeUpdateRecord');
		expect(feeUpdateEvent).not.toBeNull();
		expect(getVariant(feeUpdateEvent?.data.action)).toEqual('applied');

		vaultAcct = await vaultProgram.account.vault.fetch(commonVaultKey);
		expect(vaultAcct.managementFee.toNumber()).toEqual(
			TEN_PCT_MANAGEMENT_FEE.toNumber()
		);
		expect(vaultAcct.profitShare).toEqual(TEN_PCT_MANAGEMENT_FEE.toNumber());
		expect(vaultAcct.hurdleRate).toEqual(TWENTY_PCT_MANAGEMENT_FEE.toNumber());
	});
});
