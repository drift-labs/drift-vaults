import * as anchor from '@coral-xyz/anchor';
import { BN, Program } from '@coral-xyz/anchor';
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
} from '../ts/sdk/lib';
import {
	BulkAccountLoader,
	DRIFT_PROGRAM_ID,
	DriftClient,
	getUserStatsAccountPublicKey,
	OracleSource,
	PEG_PRECISION,
	PERCENTAGE_PRECISION,
	PublicKey,
	QUOTE_PRECISION,
	TestClient,
	UserStatsAccount,
	ZERO,
} from '@drift-labs/sdk';
import { TestBulkAccountLoader } from './common/testBulkAccountLoader';
import {
	assert,
	bootstrapSignerClientAndUserBankrun,
	initializeQuoteSpotMarket,
	initializeSolSpotMarket,
	mockUSDCMintBankrun,
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
import { Keypair } from '@solana/web3.js';
import { mockOracleNoProgram } from './common/bankrunOracle';
import { BankrunProvider } from 'anchor-bankrun';

// ammInvariant == k == x * y
const mantissaSqrtScale = new BN(100_000);
const ammInitialQuoteAssetReserve = new BN(5 * 10 ** 13).mul(mantissaSqrtScale);
const ammInitialBaseAssetReserve = new BN(5 * 10 ** 13).mul(mantissaSqrtScale);

describe('driftVaults', () => {
	let vaultProgram: Program<DriftVaults>;
	const initialSolPerpPrice = 100;
	let adminClient: TestClient;
	let bulkAccountLoader: TestBulkAccountLoader;
	let bankrunContextWrapper: BankrunContextWrapper;
	let usdcMint: PublicKey;

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

	let adminVaultClient: VaultClient;

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

		const solPerpOracle = await mockOracleNoProgram(
			bankrunContextWrapper,
			initialSolPerpPrice
		);

		adminClient = new TestClient({
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

		await adminClient.initialize(usdcMint, true);
		await adminClient.subscribe();

		await initializeQuoteSpotMarket(adminClient, usdcMint);
		await initializeSolSpotMarket(adminClient, solPerpOracle);

		await adminClient.initializePerpMarket(
			0,
			solPerpOracle,
			ammInitialBaseAssetReserve,
			ammInitialQuoteAssetReserve,
			new BN(0), // 1 HOUR
			new BN(initialSolPerpPrice).mul(PEG_PRECISION)
		);

		await adminClient.fetchAccounts();

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
			adminClient.wallet as anchor.Wallet
		);
		const program = new Program(IDL, VAULT_PROGRAM_ID, provider);
		adminVaultClient = new VaultClient({
			driftClient: adminClient,
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

		// initialize a vault and depositors
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
		await user2Client.initializeVaultDepositor(
			commonVaultKey,
			user2Signer.publicKey,
			user2Signer.publicKey
		);
		await user1Client.initializeVaultDepositor(
			commonVaultKey,
			user1Signer.publicKey,
			user1Signer.publicKey
		);
	});

	afterEach(async () => {
		await adminClient.unsubscribe();
		await adminVaultClient.unsubscribe();
		await managerClient.unsubscribe();
		await managerDriftClient.unsubscribe();
		await user2Client.unsubscribe();
		await user2DriftClient.unsubscribe();
		await user1Client.unsubscribe();
		await user1DriftClient.unsubscribe();
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

	it('Test fuel distributed to two users deposit at different times', async () => {
		// vault initially has 100k fuel
		await overWriteUserStatsFuel(
			adminClient,
			bankrunContextWrapper,
			vaultUserStatsKey,
			new BN(100_000)
		);
		let currFuel = await getUserStatsDecoded(
			adminClient,
			bankrunContextWrapper,
			vaultUserStatsKey
		);
		expect(currFuel.data.fuelTaker).toBe(100_000);

		// user1 deposits usdcAmount
		await user1Client.deposit(
			user1VaultDepositor,
			usdcAmount,
			undefined,
			undefined,
			user1UserUSDCAccount
		);
		await bankrunContextWrapper.moveTimeForward(1000);

		// vault earns +100k fuel
		await overWriteUserStatsFuel(
			adminClient,
			bankrunContextWrapper,
			vaultUserStatsKey,
			new BN(200_000)
		);
		currFuel = await getUserStatsDecoded(
			adminClient,
			bankrunContextWrapper,
			vaultUserStatsKey
		);
		expect(currFuel.data.fuelTaker).toBe(200_000);

		// user1 updates fuel
		await managerClient.updateCumulativeFuelAmount(user1VaultDepositor, {
			noLut: true,
		});

		let user1VaultDepositorAccount =
			// @ts-ignore
			(await user1Client.program.account.vaultDepositor.fetch(
				user1VaultDepositor
			)) as VaultDepositor;
		// user1 should have all the fuel since they deposited
		expect(user1VaultDepositorAccount.fuelAmount.toNumber()).toBe(100_000);

		// user2 deposits 1/2 of what user1 did, after fuel has accumulated
		await user2Client.deposit(
			user2VaultDepositor,
			usdcAmount.div(new BN(2)),
			undefined,
			undefined,
			user2UserUSDCAccount
		);
		await bankrunContextWrapper.moveTimeForward(1000);

		// vault earns +100k fuel
		await overWriteUserStatsFuel(
			adminClient,
			bankrunContextWrapper,
			vaultUserStatsKey,
			new BN(300_000)
		);
		currFuel = await getUserStatsDecoded(
			adminClient,
			bankrunContextWrapper,
			vaultUserStatsKey
		);
		expect(currFuel.data.fuelTaker).toBe(300_000);

		// all users update fuel
		await managerClient.updateCumulativeFuelAmount(user1VaultDepositor, {
			noLut: true,
		});
		await managerClient.updateCumulativeFuelAmount(user2VaultDepositor, {
			noLut: true,
		});

		user1VaultDepositorAccount =
			// @ts-ignore
			(await user1Client.program.account.vaultDepositor.fetch(
				user1VaultDepositor
			)) as VaultDepositor;
		const user2VaultDepositorAccount =
			// @ts-ignore
			(await user2Client.program.account.vaultDepositor.fetch(
				user2VaultDepositor
			)) as VaultDepositor;

		expect(user1VaultDepositorAccount.vaultShares.toNumber()).toBe(
			usdcAmount.toNumber()
		);
		expect(user2VaultDepositorAccount.vaultShares.toNumber()).toBe(
			usdcAmount.toNumber() / 2
		);

		const totalUserFuel =
			user1VaultDepositorAccount.fuelAmount.toNumber() +
			user2VaultDepositorAccount.fuelAmount.toNumber();
		expect(200_000 - totalUserFuel).toBeLessThanOrEqual(5); // vault accumulated 200k fuel since first deposit
		expect(user1VaultDepositorAccount.fuelAmount.toNumber()).toBe(166_666); // 100k + 100/150 * 100k
		expect(user2VaultDepositorAccount.fuelAmount.toNumber()).toBe(33_333); // 0 + 50/150 * 100k

		const vaultAccount =
			// @ts-ignore
			(await user2Client.program.account.vault.fetch(commonVaultKey)) as Vault;
		expect(vaultAccount.cumulativeFuel.toNumber()).toBe(300_000);

		try {
			await adminVaultClient.resetFuelSeason(user2VaultDepositor, {
				noLut: true,
			});
			await adminVaultClient.resetFuelSeason(user1VaultDepositor, {
				noLut: true,
			});
		} catch (e) {
			console.error(e);
			assert(false);
		}

		const userStats3 = (await user2DriftClient.program.account.userStats.fetch(
			vaultUserStatsKey
		)) as UserStatsAccount;
		const vd0VaultDepositorAccount2 =
			// @ts-ignore
			(await user2Client.program.account.vaultDepositor.fetch(
				user2VaultDepositor
			)) as VaultDepositor;
		const vd1VaultDepositorAccount2 =
			// @ts-ignore
			(await user2Client.program.account.vaultDepositor.fetch(
				user1VaultDepositor
			)) as VaultDepositor;
		assert(vd0VaultDepositorAccount2.fuelAmount.toNumber() === 0);
		assert(vd1VaultDepositorAccount2.fuelAmount.toNumber() === 0);
		console.log('total fuel in drift user stats:', userStats3.fuelDeposits);
		console.log(
			'vd0 vault depositor fuel amount:',
			vd0VaultDepositorAccount2.fuelAmount.toNumber()
		);
		console.log(
			'vd1 vault depositor fuel amount:',
			vd1VaultDepositorAccount2.fuelAmount.toNumber()
		);
	});

	it('Test VD Fuel Crank with shares changing', async () => {
		const startFuel = new BN(4_100_000_000);
		await createVaultWithFuelOverflow(
			adminClient,
			bankrunContextWrapper,
			commonVaultKey,
			startFuel
		);

		const vaultUserStats = getUserStatsAccountPublicKey(
			adminClient.program.programId,
			commonVaultKey
		);

		// user deposits
		const user1VaultDepositor = getVaultDepositorAddressSync(
			vaultProgram.programId,
			commonVaultKey,
			user1Signer.publicKey
		);
		await user1Client.deposit(
			user1VaultDepositor,
			usdcAmount,
			undefined,
			undefined,
			user1UserUSDCAccount
		);

		// user earns no fuel on deposit
		let vdUser1 = await user1Client.program.account.vaultDepositor.fetch(
			user1VaultDepositor
		);
		let vault = await user1Client.program.account.vault.fetch(commonVaultKey);
		expect(vdUser1.fuelAmount.toNumber()).toBe(0);
		expect(vault.cumulativeFuel.toNumber()).toBe(startFuel.toNumber());

		// vault earns 100k fuel
		const userStatsBefore = await getUserStatsDecoded(
			adminClient,
			bankrunContextWrapper,
			vaultUserStats
		);
		userStatsBefore.data.fuelTaker += 100_000;
		await overWriteUserStats(
			adminClient,
			bankrunContextWrapper,
			vaultUserStats,
			userStatsBefore
		);

		await bankrunContextWrapper.moveTimeForward(1000);
		await user1Client.updateCumulativeFuelAmount(user1VaultDepositor, {
			noLut: true,
		});

		// user1 earns 100k fuel (they're 100% of vault)
		vdUser1 = await user1Client.program.account.vaultDepositor.fetch(
			user1VaultDepositor
		);
		vault = await user1Client.program.account.vault.fetch(commonVaultKey);
		expect(vdUser1.fuelAmount.toNumber()).toBe(100_000);
		expect(vault.cumulativeFuel.toNumber()).toBe(
			startFuel.toNumber() + 100_000
		);

		// user2 deposits to be 50% of vault
		const user2VaultDepositor = getVaultDepositorAddressSync(
			vaultProgram.programId,
			commonVaultKey,
			user2Signer.publicKey
		);
		await user2Client.deposit(
			user2VaultDepositor,
			usdcAmount,
			undefined,
			undefined,
			user2UserUSDCAccount
		);

		let vdUser2 = await user2Client.program.account.vaultDepositor.fetch(
			user2VaultDepositor
		);
		vault = await user1Client.program.account.vault.fetch(commonVaultKey);
		expect(vdUser2.fuelAmount.toNumber()).toBe(0);
		expect(vault.cumulativeFuel.toNumber()).toBe(
			startFuel.toNumber() + 100_000
		);

		// vault earns another 100k fuel
		await bankrunContextWrapper.moveTimeForward(1000);
		userStatsBefore.data.fuelTaker += 100_000;
		await overWriteUserStats(
			adminClient,
			bankrunContextWrapper,
			vaultUserStats,
			userStatsBefore
		);

		await user1Client.updateCumulativeFuelAmount(user1VaultDepositor, {
			noLut: true,
		});
		await user2Client.updateCumulativeFuelAmount(user2VaultDepositor, {
			noLut: true,
		});

		// both users earn 50k fuel (since they each own 50% of vault)
		vdUser1 = await user1Client.program.account.vaultDepositor.fetch(
			user1VaultDepositor
		);
		vault = await user1Client.program.account.vault.fetch(commonVaultKey);
		expect(vdUser1.fuelAmount.toNumber()).toBe(150_000);
		expect(vault.cumulativeFuel.toNumber()).toBe(
			startFuel.toNumber() + 200_000
		);

		vdUser2 = await user2Client.program.account.vaultDepositor.fetch(
			user2VaultDepositor
		);
		expect(vdUser2.fuelAmount.toNumber()).toBe(50_000);

		// vault earns another 100k fuel
		await bankrunContextWrapper.moveTimeForward(1000);
		userStatsBefore.data.fuelTaker += 100_000;
		await overWriteUserStats(
			adminClient,
			bankrunContextWrapper,
			vaultUserStats,
			userStatsBefore
		);

		// user1 withdraws 100%
		await user1Client.requestWithdraw(
			user1VaultDepositor,
			PERCENTAGE_PRECISION,
			WithdrawUnit.SHARES_PERCENT
		);
		await user1Client.withdraw(user1VaultDepositor);

		// user2 cranks their fuel
		await user2Client.updateCumulativeFuelAmount(user2VaultDepositor, {
			noLut: true,
		});

		vdUser1 = await user1Client.program.account.vaultDepositor.fetch(
			user1VaultDepositor
		);
		vault = await user1Client.program.account.vault.fetch(commonVaultKey);
		expect(vdUser1.vaultShares.toNumber()).toBe(0);
		expect(vdUser1.fuelAmount.toNumber()).toBe(200_000);
		expect(vault.cumulativeFuel.toNumber()).toBe(
			startFuel.toNumber() + 300_000
		);

		vdUser2 = await user2Client.program.account.vaultDepositor.fetch(
			user2VaultDepositor
		);
		expect(vdUser2.fuelAmount.toNumber()).toBe(100_000);
	});

	it('Test retroactively distributing fuel to existing depositors', async () => {
		// Test the scenario when the program update goes live. Fuel distribution variables are zero even though vault has earned fuel.
		// Fuel should be retroactively distributed to existing depositors.

		// vault initially has 100k fuel
		await overWriteUserStatsFuel(
			adminClient,
			bankrunContextWrapper,
			vaultUserStatsKey,
			new BN(100_000)
		);
		const currFuel = await getUserStatsDecoded(
			adminClient,
			bankrunContextWrapper,
			vaultUserStatsKey
		);
		expect(currFuel.data.fuelTaker).toBe(100_000);

		// both users deposit 50% of vault
		await user1Client.deposit(
			user1VaultDepositor,
			usdcAmount,
			undefined,
			undefined,
			user1UserUSDCAccount
		);
		await user2Client.deposit(
			user2VaultDepositor,
			usdcAmount,
			undefined,
			undefined,
			user2UserUSDCAccount
		);

		// reset state fuel variables to 0 to mimic state when update goes live

		let user1Vd = await getVaultDepositorDecoded(
			user1Client,
			bankrunContextWrapper,
			user1VaultDepositor
		);
		user1Vd.data.lastFuelUpdateTs = 0;
		await overWriteVaultDepositor(
			user1Client,
			bankrunContextWrapper,
			user1VaultDepositor,
			user1Vd
		);

		expect(user1Vd.data.lastFuelUpdateTs).toBe(0);
		expect(user1Vd.data.fuelAmount.toNumber()).toBe(0);
		expect(user1Vd.data.cumulativeFuelPerShareAmount.toNumber()).toBe(0);
		expect(user1Vd.data.vaultShares.toNumber()).toBe(1000000000000000);

		let user2Vd = await getVaultDepositorDecoded(
			user2Client,
			bankrunContextWrapper,
			user2VaultDepositor
		);
		user2Vd.data.lastFuelUpdateTs = 0;
		await overWriteVaultDepositor(
			user2Client,
			bankrunContextWrapper,
			user2VaultDepositor,
			user2Vd
		);

		expect(user2Vd.data.lastFuelUpdateTs).toBe(0);
		expect(user2Vd.data.fuelAmount.toNumber()).toBe(0);
		expect(user2Vd.data.cumulativeFuelPerShareAmount.toNumber()).toBe(0);
		expect(user2Vd.data.vaultShares.toNumber()).toBe(1_000_000_000_000_000); // 1e9 * 1e6

		let vault = await getVaultDecoded(
			managerClient,
			bankrunContextWrapper,
			commonVaultKey
		);
		vault.data.cumulativeFuel = ZERO;
		vault.data.cumulativeFuelPerShare = ZERO;
		vault.data.lastCumulativeFuelPerShareTs = 0;
		await overWriteVault(
			managerClient,
			bankrunContextWrapper,
			commonVaultKey,
			vault
		);

		expect(vault.data.cumulativeFuel.toNumber()).toBe(0);
		expect(vault.data.cumulativeFuelPerShare.toNumber()).toBe(0);
		expect(vault.data.lastCumulativeFuelPerShareTs).toBe(0);
		expect(vault.data.userShares.toNumber()).toBe(
			vault.data.totalShares.toNumber()
		);
		expect(vault.data.userShares.toNumber()).toBe(2000000000000000);

		// deploy happens, crank fuel, expect both users to have 50% fuel
		await managerClient.updateCumulativeFuelAmount(user1VaultDepositor, {
			noLut: true,
		});

		vault = await getVaultDecoded(
			managerClient,
			bankrunContextWrapper,
			commonVaultKey
		);
		expect(vault.data.cumulativeFuel.toNumber()).toBe(100_000);
		expect(vault.data.cumulativeFuelPerShare.toNumber()).toBe(50_000_000); // 1e5 * 1e18 / 2e15 = 50e6
		expect(vault.data.lastCumulativeFuelPerShareTs).toBeGreaterThan(0);
		expect(vault.data.userShares.toNumber()).toBe(
			vault.data.totalShares.toNumber()
		);
		expect(vault.data.userShares.toNumber()).toBe(2000000000000000);

		user1Vd = await getVaultDepositorDecoded(
			user1Client,
			bankrunContextWrapper,
			user1VaultDepositor
		);
		expect(user1Vd.data.lastFuelUpdateTs).toBeGreaterThan(0);
		expect(user1Vd.data.fuelAmount.toNumber()).toBe(50_000); // 50% of vault fuel
		expect(user1Vd.data.cumulativeFuelPerShareAmount.toNumber()).toBe(
			50_000_000
		);
		expect(user1Vd.data.vaultShares.toNumber()).toBe(1000000000000000);

		await managerClient.updateCumulativeFuelAmount(user2VaultDepositor, {
			noLut: true,
		});
		user2Vd = await getVaultDepositorDecoded(
			user2Client,
			bankrunContextWrapper,
			user2VaultDepositor
		);
		expect(user2Vd.data.lastFuelUpdateTs).toBeGreaterThan(0);
		expect(user2Vd.data.fuelAmount.toNumber()).toBe(50_000); // 50% of vault fuel
		expect(user2Vd.data.cumulativeFuelPerShareAmount.toNumber()).toBe(
			50_000_000
		);
		expect(user2Vd.data.vaultShares.toNumber()).toBe(1000000000000000);
	});

	it('Test new depositors dont get fuel accrued before they deposited', async () => {
		// vault initially has 100k fuel
		await overWriteUserStatsFuel(
			adminClient,
			bankrunContextWrapper,
			vaultUserStatsKey,
			new BN(100_000)
		);
		let currFuel = await getUserStatsDecoded(
			adminClient,
			bankrunContextWrapper,
			vaultUserStatsKey
		);
		expect(currFuel.data.fuelTaker).toBe(100_000);

		// both users deposit 50% of vault
		await user1Client.deposit(
			user1VaultDepositor,
			usdcAmount,
			undefined,
			undefined,
			user1UserUSDCAccount
		);
		await user2Client.deposit(
			user2VaultDepositor,
			usdcAmount,
			undefined,
			undefined,
			user2UserUSDCAccount
		);

		// crank fuel, expect both users have 0 fuel still.
		await managerClient.updateCumulativeFuelAmount(user1VaultDepositor, {
			noLut: true,
		});

		let vault = await getVaultDecoded(
			managerClient,
			bankrunContextWrapper,
			commonVaultKey
		);
		expect(vault.data.cumulativeFuel.toNumber()).toBe(100_000);
		expect(vault.data.cumulativeFuelPerShare.toNumber()).toBe(0); // 1e5 * 1e18 / 2e15 = 50e6
		expect(vault.data.lastCumulativeFuelPerShareTs).toBeGreaterThan(0);
		expect(vault.data.userShares.toNumber()).toBe(
			vault.data.totalShares.toNumber()
		);
		expect(vault.data.userShares.toNumber()).toBe(2000000000000000);

		let user1Vd = await getVaultDepositorDecoded(
			user1Client,
			bankrunContextWrapper,
			user1VaultDepositor
		);
		expect(user1Vd.data.lastFuelUpdateTs).toBeGreaterThan(0);
		expect(user1Vd.data.fuelAmount.toNumber()).toBe(0); // no fuel
		expect(user1Vd.data.cumulativeFuelPerShareAmount.toNumber()).toBe(0);
		expect(user1Vd.data.vaultShares.toNumber()).toBe(1000000000000000);

		await managerClient.updateCumulativeFuelAmount(user2VaultDepositor, {
			noLut: true,
		});
		let user2Vd = await getVaultDepositorDecoded(
			user2Client,
			bankrunContextWrapper,
			user2VaultDepositor
		);
		expect(user2Vd.data.lastFuelUpdateTs).toBeGreaterThan(0);
		expect(user2Vd.data.fuelAmount.toNumber()).toBe(0); // no fuel
		expect(user2Vd.data.cumulativeFuelPerShareAmount.toNumber()).toBe(0);
		expect(user2Vd.data.vaultShares.toNumber()).toBe(1000000000000000);

		// vault earns another 100k fuel
		await overWriteUserStatsFuel(
			adminClient,
			bankrunContextWrapper,
			vaultUserStatsKey,
			new BN(200_000)
		);
		currFuel = await getUserStatsDecoded(
			adminClient,
			bankrunContextWrapper,
			vaultUserStatsKey
		);
		expect(currFuel.data.fuelTaker).toBe(200_000);
		await bankrunContextWrapper.moveTimeForward(1000);

		// users crank fuel, expect both users to have 50k fuel each
		await managerClient.updateCumulativeFuelAmount(user1VaultDepositor, {
			noLut: true,
		});

		vault = await getVaultDecoded(
			managerClient,
			bankrunContextWrapper,
			commonVaultKey
		);
		expect(vault.data.cumulativeFuel.toNumber()).toBe(200_000);
		expect(vault.data.cumulativeFuelPerShare.toNumber()).toBe(50_000_000); // 1e5 * 1e18 / 2e15 = 50e6
		expect(vault.data.lastCumulativeFuelPerShareTs).toBeGreaterThan(0);
		expect(vault.data.userShares.toNumber()).toBe(
			vault.data.totalShares.toNumber()
		);
		expect(vault.data.userShares.toNumber()).toBe(2000000000000000);

		user1Vd = await getVaultDepositorDecoded(
			user1Client,
			bankrunContextWrapper,
			user1VaultDepositor
		);
		expect(user1Vd.data.lastFuelUpdateTs).toBeGreaterThan(0);
		expect(user1Vd.data.fuelAmount.toNumber()).toBe(50_000); // 50% of vault fuel
		expect(user1Vd.data.cumulativeFuelPerShareAmount.toNumber()).toBe(
			50_000_000
		);
		expect(user1Vd.data.vaultShares.toNumber()).toBe(1000000000000000);

		await managerClient.updateCumulativeFuelAmount(user2VaultDepositor, {
			noLut: true,
		});
		user2Vd = await getVaultDepositorDecoded(
			user2Client,
			bankrunContextWrapper,
			user2VaultDepositor
		);
		expect(user2Vd.data.lastFuelUpdateTs).toBeGreaterThan(0);
		expect(user2Vd.data.fuelAmount.toNumber()).toBe(50_000); // 50% of vault fuel
		expect(user2Vd.data.cumulativeFuelPerShareAmount.toNumber()).toBe(
			50_000_000
		);
		expect(user2Vd.data.vaultShares.toNumber()).toBe(1000000000000000);
	});
});
