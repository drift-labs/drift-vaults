import * as anchor from '@coral-xyz/anchor';
import { BN, Program } from '@coral-xyz/anchor';
import { describe, beforeAll, afterAll, it } from '@jest/globals';
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
} from '../ts/sdk/lib';
import {
	BulkAccountLoader,
	DRIFT_PROGRAM_ID,
	DriftClient,
	FuelOverflowStatus,
	getFuelOverflowAccountPublicKey,
	getUserAccountPublicKey,
	getUserStatsAccountPublicKey,
	OracleSource,
	PEG_PRECISION,
	PERCENTAGE_PRECISION,
	PublicKey,
	QUOTE_PRECISION,
	TestClient,
	UserAccount,
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
	printTxLogs,
} from './common/testHelpers';
import { AccountInfo, Keypair } from '@solana/web3.js';
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
	const usdcAmount = new BN(1_000_000_000).mul(QUOTE_PRECISION);

	const managerSigner = Keypair.generate();
	let managerClient: VaultClient;
	let managerDriftClient: DriftClient;

	let adminVaultClient: VaultClient;

	const vd0Signer = Keypair.generate();
	let vd0Client: VaultClient;
	let vd0DriftClient: DriftClient;
	let vd0UserUSDCAccount: PublicKey;

	const vd1Signer = Keypair.generate();
	let vd1Client: VaultClient;
	let vd1DriftClient: DriftClient;
	let vd1UserUSDCAccount: PublicKey;

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

		const vd0Bootstrap = await bootstrapSignerClientAndUserBankrun({
			bankrunContext: bankrunContextWrapper,
			programId: VAULT_PROGRAM_ID,
			signer: vd0Signer,
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
		vd0Client = vd0Bootstrap.vaultClient;
		vd0DriftClient = vd0Bootstrap.driftClient;
		vd0UserUSDCAccount = vd0Bootstrap.userUSDCAccount.publicKey;

		const vd1Bootstrap = await bootstrapSignerClientAndUserBankrun({
			bankrunContext: bankrunContextWrapper,
			programId: VAULT_PROGRAM_ID,
			signer: vd1Signer,
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
		vd1Client = vd1Bootstrap.vaultClient;
		vd1DriftClient = vd1Bootstrap.driftClient;
		vd1UserUSDCAccount = vd1Bootstrap.userUSDCAccount.publicKey;

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
		await vd0Client.initializeVaultDepositor(
			commonVaultKey,
			vd0Signer.publicKey,
			vd0Signer.publicKey
		);
		await vd1Client.initializeVaultDepositor(
			commonVaultKey,
			vd1Signer.publicKey,
			vd1Signer.publicKey
		);
	});

	afterEach(async () => {
		await adminClient.unsubscribe();
		await adminVaultClient.unsubscribe();
		await managerClient.unsubscribe();
		await managerDriftClient.unsubscribe();
		await vd0Client.unsubscribe();
		await vd0DriftClient.unsubscribe();
		await vd1Client.unsubscribe();
		await vd1DriftClient.unsubscribe();
	});

	it('vaults initialized', async () => {
		const vaultAcct = await vaultProgram.account.vault.fetch(commonVaultKey);
		expect(vaultAcct.manager).toEqual(managerSigner.publicKey);

		const vaultDepositor = getVaultDepositorAddressSync(
			vaultProgram.programId,
			commonVaultKey,
			vd0Signer.publicKey
		);
		const vdAcct = await vaultProgram.account.vaultDepositor.fetch(
			vaultDepositor
		);
		expect(vdAcct.vault).toEqual(commonVaultKey);

		const vaultDepositor2 = getVaultDepositorAddressSync(
			vaultProgram.programId,
			commonVaultKey,
			vd1Signer.publicKey
		);
		const vdAcct2 = await vaultProgram.account.vaultDepositor.fetch(
			vaultDepositor2
		);
		expect(vdAcct2.vault).toEqual(commonVaultKey);
	});

	it('Test Fuel', async () => {
		let tx = await adminClient.updateSpotMarketFuel(0, 255, 255, 255, 255, 255);
		await printTxLogs(bankrunContextWrapper.connection.toConnection(), tx);

		const vd0VaultDepositor = getVaultDepositorAddressSync(
			vaultProgram.programId,
			commonVaultKey,
			vd0Signer.publicKey
		);
		await vd0Client.deposit(
			vd0VaultDepositor,
			usdcAmount,
			undefined,
			undefined,
			vd0UserUSDCAccount
		);

		const userStatsKey = getUserStatsAccountPublicKey(
			managerDriftClient.program.programId,
			commonVaultKey
		);
		const userStats0 = (await vd0DriftClient.program.account.userStats.fetch(
			userStatsKey
		)) as UserStatsAccount;
		const userStats0FuelDeposits = userStats0.fuelDeposits;

		const vaultUser = await getUserAccountPublicKey(
			managerDriftClient.program.programId,
			commonVaultKey,
			0
		);
		const vaultUserAccount = (await vd0DriftClient.program.account.user.fetch(
			vaultUser
		)) as UserAccount;
		tx = await vd0DriftClient.updateUserFuelBonus(
			vaultUser,
			vaultUserAccount,
			commonVaultKey
		);

		await bankrunContextWrapper.moveTimeForward(1000);

		tx = await vd0DriftClient.updateUserFuelBonus(
			vaultUser,
			vaultUserAccount,
			commonVaultKey
		);

		const userStats1 = (await vd0DriftClient.program.account.userStats.fetch(
			userStatsKey
		)) as UserStatsAccount;
		const userStats1FuelDeposits = userStats1.fuelDeposits;
		assert(
			userStats1FuelDeposits > userStats0FuelDeposits,
			'fuel deposits should increase'
		);

		try {
			tx = await managerClient.updateCumulativeFuelAmount(vd0VaultDepositor, {
				noLut: true,
			});
			await printTxLogs(bankrunContextWrapper.connection.toConnection(), tx);
		} catch (e) {
			console.error(e);
			assert(false);
		}

		// vd1 deposits 1/2 of what vd0 did
		const vd1VaultDepositor = getVaultDepositorAddressSync(
			vaultProgram.programId,
			commonVaultKey,
			vd1Signer.publicKey
		);
		await vd1Client.deposit(
			vd1VaultDepositor,
			usdcAmount.div(new BN(2)),
			undefined,
			undefined,
			vd1UserUSDCAccount
		);

		await bankrunContextWrapper.moveTimeForward(10_000);
		await vd0DriftClient.updateUserFuelBonus(
			vaultUser,
			vaultUserAccount,
			commonVaultKey
		);

		// update both user fuel
		await managerClient.updateCumulativeFuelAmount(vd0VaultDepositor, {
			noLut: true,
		});
		await managerClient.updateCumulativeFuelAmount(vd1VaultDepositor, {
			noLut: true,
		});

		const userStats2 = (await vd0DriftClient.program.account.userStats.fetch(
			userStatsKey
		)) as UserStatsAccount;
		const vd0VaultDepositorAccount1 =
			// @ts-ignore
			(await vd0Client.program.account.vaultDepositor.fetch(
				vd0VaultDepositor
			)) as VaultDepositor;
		const vd1VaultDepositorAccount1 =
			// @ts-ignore
			(await vd0Client.program.account.vaultDepositor.fetch(
				vd1VaultDepositor
			)) as VaultDepositor;
		const totalUserFuel =
			vd0VaultDepositorAccount1.fuelAmount.toNumber() +
			vd1VaultDepositorAccount1.fuelAmount.toNumber();
		expect(
			Math.abs(totalUserFuel - userStats2.fuelDeposits)
		).toBeLessThanOrEqual(10);
		expect(vd0VaultDepositorAccount1.fuelAmount.toNumber()).toBeGreaterThan(0);
		expect(vd1VaultDepositorAccount1.fuelAmount.toNumber()).toBeGreaterThan(0);
		expect(vd0VaultDepositorAccount1.fuelAmount.toNumber()).toBeGreaterThan(
			vd1VaultDepositorAccount1.fuelAmount.toNumber()
		);

		try {
			tx = await adminVaultClient.resetFuelSeason(vd0VaultDepositor, {
				noLut: true,
			});
			// @ts-ignore
			// await printTxLogs(bankrunContextWrapper.connection.toConnection(), tx, true, vaultProgram);

			tx = await adminVaultClient.resetFuelSeason(vd1VaultDepositor, {
				noLut: true,
			});
			// @ts-ignore
			// await printTxLogs(bankrunContextWrapper.connection.toConnection(), tx, true, vaultProgram);
		} catch (e) {
			console.error(e);
			assert(false);
		}

		const userStats3 = (await vd0DriftClient.program.account.userStats.fetch(
			userStatsKey
		)) as UserStatsAccount;
		const vd0VaultDepositorAccount2 =
			// @ts-ignore
			(await vd0Client.program.account.vaultDepositor.fetch(
				vd0VaultDepositor
			)) as VaultDepositor;
		const vd1VaultDepositorAccount2 =
			// @ts-ignore
			(await vd0Client.program.account.vaultDepositor.fetch(
				vd1VaultDepositor
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

	it('Test Fuel With Overflow account', async () => {
		const startFuel = new BN(4_100_000_000);
		await createVaultWithFuelOverflow(adminClient, bankrunContextWrapper, commonVaultKey, startFuel);

		const vaultUserStats = getUserStatsAccountPublicKey(
			adminClient.program.programId,
			commonVaultKey
		);

		// user deposits
		const vd1VaultDepositor = getVaultDepositorAddressSync(
			vaultProgram.programId,
			commonVaultKey,
			vd1Signer.publicKey
		);
		await vd1Client.deposit(
			vd1VaultDepositor,
			usdcAmount,
			undefined,
			undefined,
			vd1UserUSDCAccount
		);

		// user earns no fuel on deposit
		let vd1 = await vd1Client.program.account.vaultDepositor.fetch(vd1VaultDepositor);
		expect(vd1.fuelAmount.toNumber()).toBe(0);
		expect(vd1.cumulativeFuelAmount.toNumber()).toBe(startFuel.toNumber());

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
		await vd1Client.updateCumulativeFuelAmount(vd1VaultDepositor, {
			noLut: true,
		});

		// vd1 earns 100k fuel (they're 100% of vault)
		vd1 = await vd1Client.program.account.vaultDepositor.fetch(vd1VaultDepositor);
		expect(vd1.fuelAmount.toNumber()).toBe(100_000);
		expect(vd1.cumulativeFuelAmount.toNumber()).toBe(startFuel.toNumber() + 100_000);

		// vd0 deposits to be 50% of vault
		const vd0VaultDepositor = getVaultDepositorAddressSync(
			vaultProgram.programId,
			commonVaultKey,
			vd0Signer.publicKey
		);
		await vd0Client.deposit(
			vd0VaultDepositor,
			usdcAmount,
			undefined,
			undefined,
			vd0UserUSDCAccount
		);

		let vd0 = await vd0Client.program.account.vaultDepositor.fetch(vd0VaultDepositor);
		expect(vd0.fuelAmount.toNumber()).toBe(0);
		expect(vd0.cumulativeFuelAmount.toNumber()).toBe(startFuel.toNumber() + 100_000);

		// vault earns another 100k fuel
		await bankrunContextWrapper.moveTimeForward(1000);
		userStatsBefore.data.fuelTaker += 100_000;
		await overWriteUserStats(
			adminClient,
			bankrunContextWrapper,
			vaultUserStats,
			userStatsBefore
		);

		await vd0Client.updateCumulativeFuelAmount(vd0VaultDepositor, {
			noLut: true,
		});
		await vd1Client.updateCumulativeFuelAmount(vd1VaultDepositor, {
			noLut: true,
		});

		// both users earn 50k fuel (50% of vault)
		vd1 = await vd1Client.program.account.vaultDepositor.fetch(vd1VaultDepositor);
		expect(vd1.fuelAmount.toNumber()).toBe(150_000);
		expect(vd1.cumulativeFuelAmount.toNumber()).toBe(startFuel.toNumber() + 200_000);

		vd0 = await vd0Client.program.account.vaultDepositor.fetch(vd0VaultDepositor);
		expect(vd0.fuelAmount.toNumber()).toBe(50_000);
		expect(vd0.cumulativeFuelAmount.toNumber()).toBe(startFuel.toNumber() + 200_000);

		// vault earns another 100k fuel
		await bankrunContextWrapper.moveTimeForward(1000);
		userStatsBefore.data.fuelTaker += 100_000;
		await overWriteUserStats(
			adminClient,
			bankrunContextWrapper,
			vaultUserStats,
			userStatsBefore
		);

		// vd1 withdraws
		await vd1Client.requestWithdraw(vd1VaultDepositor, PERCENTAGE_PRECISION, WithdrawUnit.SHARES_PERCENT);
		await vd1Client.withdraw(vd1VaultDepositor);

		await vd0Client.updateCumulativeFuelAmount(vd0VaultDepositor, {
			noLut: true,
		});

		vd1 = await vd1Client.program.account.vaultDepositor.fetch(vd1VaultDepositor);
		expect(vd1.vaultShares.toNumber()).toBe(0);
		expect(vd1.fuelAmount.toNumber()).toBe(200_000);
		expect(vd1.cumulativeFuelAmount.toNumber()).toBe(startFuel.toNumber() + 300_000);

		vd0 = await vd0Client.program.account.vaultDepositor.fetch(vd0VaultDepositor);
		expect(vd0.fuelAmount.toNumber()).toBe(100_000);
		expect(vd0.cumulativeFuelAmount.toNumber()).toBe(startFuel.toNumber() + 300_000);


	});
});

async function createVaultWithFuelOverflow(
	driftClient: TestClient,
	bankrunContextWrapper: BankrunContextWrapper,
	commonVaultKey: PublicKey,
	fuelAmount: BN = new BN(4_100_000_000),
) {
	const userStatsKey = getUserStatsAccountPublicKey(
		driftClient.program.programId,
		commonVaultKey
	);
	const userStatsBefore = await getUserStatsDecoded(
		driftClient,
		bankrunContextWrapper,
		userStatsKey
	);
	userStatsBefore.data.fuelTaker = fuelAmount.toNumber();
	await overWriteUserStats(
		driftClient,
		bankrunContextWrapper,
		userStatsKey,
		userStatsBefore
	);

	await driftClient.initializeFuelOverflow(commonVaultKey);
	await driftClient.sweepFuel(commonVaultKey);

	const userStatsAfterSweep =
		await driftClient.program.account.userStats.fetch(userStatsKey);
	expect(userStatsAfterSweep.fuelTaker).toBe(0);
	expect(userStatsAfterSweep.fuelOverflowStatus as number &
		FuelOverflowStatus.Exists
	).toBe(FuelOverflowStatus.Exists);

	const userFuelSweepAccount =
		await driftClient.program.account.fuelOverflow.fetch(
			getFuelOverflowAccountPublicKey(
				driftClient.program.programId,
				commonVaultKey
			)
		);
	expect(
		// @ts-ignore
		userFuelSweepAccount.authority.equals(commonVaultKey)
	).toBe(true);
	expect((userFuelSweepAccount.fuelTaker as BN).toNumber()).toBe(fuelAmount.toNumber());
}

async function getUserStatsDecoded(
	driftClient: TestClient,
	bankrunContextWrapper: BankrunContextWrapper,
	userStatsKey: PublicKey
): Promise<AccountInfo<UserStatsAccount>> {
	const accountInfo = await bankrunContextWrapper.connection.getAccountInfo(
		userStatsKey
	);
	const userStatsBefore: UserStatsAccount =
		driftClient.program.account.userStats.coder.accounts.decode(
			'UserStats',
			accountInfo!.data
		);

	// @ts-ignore
	accountInfo.data = userStatsBefore;
	// @ts-ignore
	return accountInfo;
}

async function overWriteUserStats(
	driftClient: TestClient,
	bankrunContextWrapper: BankrunContextWrapper,
	userStatsKey: PublicKey,
	userStats: AccountInfo<UserStatsAccount>
) {
	bankrunContextWrapper.context.setAccount(userStatsKey, {
		executable: userStats.executable,
		owner: userStats.owner,
		lamports: userStats.lamports,
		data: await driftClient.program.account.userStats.coder.accounts.encode(
			'UserStats',
			userStats.data
		),
		rentEpoch: userStats.rentEpoch,
	});
}
