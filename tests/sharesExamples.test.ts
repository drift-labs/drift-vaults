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
	WithdrawUnit,
} from '../ts/sdk/lib';
import {
	BulkAccountLoader,
	DRIFT_PROGRAM_ID,
	DriftClient,
	OracleSource,
	PEG_PRECISION,
	PERCENTAGE_PRECISION,
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
import { readUnsignedBigInt64LE } from './common/bankrunHelpers';
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
	let adminDriftClient: TestClient;
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

	let solPerpOracle: PublicKey;

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
	});

	it('vaults initialized', async () => {
		await user1Client.deposit(
			user1VaultDepositor,
			new BN(100_000 * QUOTE_PRECISION.toNumber()),
			undefined,
			{ noLut: true },
			user1UserUSDCAccount
		);
		await bankrunContextWrapper.moveTimeForward(1000);

		let vault = await user1Client.program.account.vault.fetch(commonVaultKey);
		// console.log(vault.totalShares.toString());
		// console.log(vault.userShares.toString());

		let vd1 = await user1Client.program.account.vaultDepositor.fetch(
			user1VaultDepositor
		);
		// console.log(vd1.vaultShares.toString());

		await user1DriftClient.fetchAccounts();

		let vaultEquity = await managerClient.calculateVaultEquity({
			// address: commonVaultKey,
			// @ts-ignore
			vault,
		});
		// console.log(`Vault equity ${vaultEquity.toString()}`);
		// console.log('user 2 deposits 200k');

		await user2Client.deposit(
			user2VaultDepositor,
			new BN(200_000 * QUOTE_PRECISION.toNumber()),
			undefined,
			{ noLut: true },
			user2UserUSDCAccount
		);
		await bankrunContextWrapper.moveTimeForward(1000);

		vault = await user2Client.program.account.vault.fetch(commonVaultKey);
		// console.log('vault total shares', vault.totalShares.toString());
		// console.log('vault user shares', vault.userShares.toString());

		let vd2 = await user2Client.program.account.vaultDepositor.fetch(
			user2VaultDepositor
		);
		// console.log('vault2 shares', vd2.vaultShares.toString());

		await user2Client.syncVaultUsers();
		await user2DriftClient.fetchAccounts();

		vaultEquity = await user2Client.calculateVaultEquity({
			address: commonVaultKey,
		});
		// console.log('vault equity', vaultEquity.toString());

		expect(vaultEquity.toString()).toBe('300000000000');

		// console.log(vault.user);

		const updateVaultUserBalance = async (numerator: BN, denominator: BN) => {
			const vaultUser = await bankrunContextWrapper.connection.getAccountInfo(
				vault.user
			);
			const userBuffer = Buffer.from(vaultUser!.data!);
			const scaledBalance = readUnsignedBigInt64LE(userBuffer, 104);
			userBuffer.writeBigUInt64LE(
				BigInt(scaledBalance.mul(numerator).div(denominator).toString()),
				104
			);

			bankrunContextWrapper.context.setAccount(vault.user, {
				executable: vaultUser!.executable,
				owner: vaultUser!.owner,
				lamports: vaultUser!.lamports,
				data: userBuffer,
				rentEpoch: vaultUser!.rentEpoch,
			});
		};

		/// vault +10%
		await updateVaultUserBalance(new BN(110), new BN(100));

		await user2Client.syncVaultUsers();
		vaultEquity = await user2Client.calculateVaultEquity({
			address: commonVaultKey,
		});
		expect(vaultEquity.toString()).toBe('330000000000');

		// user1 requests 100% withdraw
		await user1Client.syncVaultUsers();
		await user1DriftClient.fetchAccounts();
		await user1Client.requestWithdraw(
			user1VaultDepositor,
			PERCENTAGE_PRECISION,
			WithdrawUnit.SHARES_PERCENT,
			{ noLut: true }
		);

		vd1 = await user1Client.program.account.vaultDepositor.fetch(
			user1VaultDepositor
		);
		// console.log(vd1);

		// vault +10%
		await updateVaultUserBalance(new BN(110), new BN(100));
		await user2Client.syncVaultUsers();
		vaultEquity = await user2Client.calculateVaultEquity({
			address: commonVaultKey,
		});
		expect(vaultEquity.toString()).toBe('363000000000');

		await user1Client.cancelRequestWithdraw(user1VaultDepositor, {
			noLut: true,
		});

		vault = await user1Client.program.account.vault.fetch(commonVaultKey);
		// console.log(vault);

		vd1 = await user1Client.program.account.vaultDepositor.fetch(
			user1VaultDepositor
		);
		// console.log(vd1);

		vd2 = await user1Client.program.account.vaultDepositor.fetch(
			user1VaultDepositor
		);
		// console.log(vd2);

		// vault -10%
		await updateVaultUserBalance(new BN(90), new BN(100));
		await user2Client.syncVaultUsers();
		vaultEquity = await user2Client.calculateVaultEquity({
			address: commonVaultKey,
		});
		expect(vaultEquity.toString()).toBe('326700000000');

		// user1 requests 100% withdraw
		await user1Client.syncVaultUsers();
		await user1DriftClient.fetchAccounts();
		const tx0 = await user1Client.requestWithdraw(
			user1VaultDepositor,
			PERCENTAGE_PRECISION,
			WithdrawUnit.SHARES_PERCENT,
			{ noLut: true }
		);
		await printTxLogs(
			bankrunContextWrapper.connection.toConnection(),
			tx0,
			true,
			// @ts-ignore
			user1Client.program
		);
		await bankrunContextWrapper.moveTimeForward(1000);

		// vault -50%
		await updateVaultUserBalance(new BN(50), new BN(100));
		await user2Client.syncVaultUsers();
		vaultEquity = await user2Client.calculateVaultEquity({
			address: commonVaultKey,
		});
		expect(vaultEquity.toString()).toBe('163350000000');
		await bankrunContextWrapper.moveTimeForward(1000);

		await user1Client.syncVaultUsers();
		await user1DriftClient.fetchAccounts();
		const tx = await user1Client.withdraw(user1VaultDepositor, { noLut: true });
		await printTxLogs(
			bankrunContextWrapper.connection.toConnection(),
			tx,
			true,
			// @ts-ignore
			user1Client.program
		);

		vault = await user1Client.program.account.vault.fetch(commonVaultKey);
		// console.log('vault', vault);

		vd1 = await user1Client.program.account.vaultDepositor.fetch(
			user1VaultDepositor
		);
		// console.log('vd1', vd1);
		expect(vd1.vaultShares.toString()).toBe('0');

		vd2 = await user2Client.program.account.vaultDepositor.fetch(
			user2VaultDepositor
		);
		// console.log('vd2', vd2);
		expect(vd2.vaultShares.toString()).toBe('200000000000');

		await user2Client.syncVaultUsers();
		vaultEquity = await user2Client.calculateVaultEquity({
			address: commonVaultKey,
		});
		// console.log('vault equity', vaultEquity.toString());
		expect(vaultEquity.toString()).toBe('113850000000');
	});
});
