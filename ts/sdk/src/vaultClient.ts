import {
	BN,
	DriftClient,
	encodeName,
	getInsuranceFundStakeAccountPublicKey,
	getUserAccountPublicKey,
	getUserAccountPublicKeySync,
	getUserStatsAccountPublicKey,
	TEN,
	UserMap,
	unstakeSharesToAmount as depositSharesToVaultAmount,
} from '@drift-labs/sdk';
import { BorshAccountsCoder, Program, ProgramAccount } from '@coral-xyz/anchor';
import { DriftVaults } from './types/drift_vaults';
import {
	CompetitionsClient,
	getCompetitionAddressSync,
	getCompetitorAddressSync,
} from '@drift-labs/competitions-sdk';
import {
	getTokenVaultAddressSync,
	getVaultAddressSync,
	getVaultDepositorAddressSync,
	getVaultProtocolAddressSync,
} from './addresses';
import {
	AccountMeta,
	AddressLookupTableAccount,
	ComputeBudgetProgram,
	PublicKey,
	SystemProgram,
	SYSVAR_RENT_PUBKEY,
	TransactionInstruction,
	TransactionSignature,
	VersionedTransaction,
} from '@solana/web3.js';
import {
	createAssociatedTokenAccountInstruction,
	getAssociatedTokenAddressSync,
	TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import {
	UpdateVaultParams,
	UpdateVaultProtocolParams,
	Vault,
	VaultDepositor,
	VaultParams,
	VaultProtocol,
	VaultProtocolParams,
	WithdrawUnit,
} from './types/types';
import { bs58 } from '@coral-xyz/anchor/dist/cjs/utils/bytes';
import { UserMapConfig } from '@drift-labs/sdk/lib/userMap/userMapConfig';
import { calculateRealizedVaultDepositorEquity } from './math';

export type TxParams = {
	cuLimit?: number;
	cuPriceMicroLamports?: number;
	simulateTransaction?: boolean;
	lookupTables?: AddressLookupTableAccount[];
};

export class VaultClient {
	driftClient: DriftClient;
	program: Program<DriftVaults>;
	cliMode: boolean;

	/**
	 * Cache map of drift user accounts of vaults.
	 */
	readonly vaultUsers: UserMap;

	constructor({
		driftClient,
		program,
		cliMode,
		userMapConfig,
	}: {
		driftClient: DriftClient;
		program: Program<DriftVaults>;
		cliMode?: boolean;
		userMapConfig?: UserMapConfig;
	}) {
		this.driftClient = driftClient;
		this.program = program;
		this.cliMode = !!cliMode;

		if (!userMapConfig) {
			this.vaultUsers = new UserMap({
				driftClient: driftClient,
				subscriptionConfig: {
					type: 'polling',
					frequency: 1000,
					commitment: 'processed',
				},
			});
		} else {
			this.vaultUsers = new UserMap(userMapConfig);
		}
	}

	public async getVault(vault: PublicKey): Promise<Vault> {
		return await this.program.account.vault.fetch(vault);
	}

	public async getVaultAndSlot(
		vault: PublicKey
	): Promise<{ vault: Vault; slot: number }> {
		const vaultAndSlot = await this.program.account.vault.fetchAndContext(
			vault
		);
		return {
			vault: vaultAndSlot.data as Vault,
			slot: vaultAndSlot.context.slot,
		};
	}

	public async getVaultDepositor(vaultDepositor: PublicKey): Promise<any> {
		return await this.program.account.vaultDepositor.fetch(vaultDepositor);
	}

	public async getVaultDepositorAndSlot(
		vaultDepositor: PublicKey
	): Promise<{ vaultDepositor: any; slot: number }> {
		const vaultDepositorAndSlot =
			await this.program.account.vaultDepositor.fetchAndContext(vaultDepositor);
		return {
			vaultDepositor: vaultDepositorAndSlot.data,
			slot: vaultDepositorAndSlot.context.slot,
		};
	}

	public getVaultProtocolAddress(vault: PublicKey): PublicKey {
		return getVaultProtocolAddressSync(this.program.programId, vault);
	}

	public async getVaultProtocol(
		vaultProtocol: PublicKey
	): Promise<VaultProtocol> {
		return await this.program.account.vaultProtocol.fetch(vaultProtocol);
	}

	public async getVaultProtocolAndSlot(
		vaultProtocol: PublicKey
	): Promise<{ vaultProtocol: VaultProtocol; slot: number }> {
		const vaultProtocolAndSlot =
			await this.program.account.vaultProtocol.fetchAndContext(vaultProtocol);
		return {
			vaultProtocol: vaultProtocolAndSlot.data as VaultProtocol,
			slot: vaultProtocolAndSlot.context.slot,
		};
	}

	public async getAllVaultDepositorsWithNoWithdrawRequest(
		vault: PublicKey
	): Promise<ProgramAccount<VaultDepositor>[]> {
		const filters = [
			{
				// discriminator = VaultDepositor
				memcmp: {
					offset: 0,
					bytes: bs58.encode(
						BorshAccountsCoder.accountDiscriminator('VaultDepositor')
					),
				},
			},
			{
				// vault = vault
				memcmp: {
					offset: 8,
					bytes: vault.toBase58(),
				},
			},
			{
				// last_withdraw_request.shares (u128) = 0
				memcmp: {
					offset: 112,
					bytes: bs58.encode(new Uint8Array(16).fill(0)),
				},
			},
		];
		// @ts-ignore
		return (await this.program.account.vaultDepositor.all(
			filters
		)) as ProgramAccount<VaultDepositor>[];
	}

	public async getAllVaultDepositors(
		vault: PublicKey
	): Promise<ProgramAccount<VaultDepositor>[]> {
		const filters = [
			{
				// discriminator = VaultDepositor
				memcmp: {
					offset: 0,
					bytes: bs58.encode(
						BorshAccountsCoder.accountDiscriminator('VaultDepositor')
					),
				},
			},
			{
				// vault = vault
				memcmp: {
					offset: 8,
					bytes: vault.toBase58(),
				},
			},
		];
		// @ts-ignore
		return (await this.program.account.vaultDepositor.all(
			filters
		)) as ProgramAccount<VaultDepositor>[];
	}

	public async getSubscribedVaultUser(vaultDriftUserAccountPubKey: PublicKey) {
		return this.vaultUsers.mustGet(vaultDriftUserAccountPubKey.toBase58(), {
			type: 'websocket',
		});
	}

	/**
	 *
	 * @param vault pubkey
	 * @param factorUnrealizedPNL add unrealized pnl to net balance
	 * @returns vault equity, in USDC
	 */
	public async calculateVaultEquity(params: {
		address?: PublicKey;
		vault?: Vault;
		factorUnrealizedPNL?: boolean;
	}): Promise<BN> {
		// defaults to true if undefined
		let factorUnrealizedPNL = true;
		if (params.factorUnrealizedPNL !== undefined) {
			factorUnrealizedPNL = params.factorUnrealizedPNL;
		}

		let vaultAccount: Vault;
		if (params.address !== undefined) {
			// @ts-ignore
			vaultAccount = await this.program.account.vault.fetch(params.address);
		} else if (params.vault !== undefined) {
			vaultAccount = params.vault;
		} else {
			throw new Error('Must supply address or vault');
		}

		const user = await this.getSubscribedVaultUser(vaultAccount.user);

		const netSpotValue = user.getNetSpotMarketValue();

		if (factorUnrealizedPNL) {
			const unrealizedPnl = user.getUnrealizedPNL(true, undefined, undefined);
			return netSpotValue.add(unrealizedPnl);
		} else {
			return netSpotValue;
		}
	}

	/**
	 *
	 * @param vault pubkey
	 * @param factorUnrealizedPNL add unrealized pnl to existing equity
	 * @returns total vault equity, in spot deposit asset
	 */
	public async calculateVaultEquityInDepositAsset(params: {
		address?: PublicKey;
		vault?: Vault;
		factorUnrealizedPNL?: boolean;
	}): Promise<BN> {
		let vaultAccount: Vault;
		if (params.address !== undefined) {
			vaultAccount = await this.program.account.vault.fetch(params.address);
		} else if (params.vault !== undefined) {
			vaultAccount = params.vault;
		} else {
			throw new Error('Must supply address or vault');
		}
		const vaultEquity = await this.calculateVaultEquity({
			vault: vaultAccount,
			factorUnrealizedPNL: params.factorUnrealizedPNL,
		});
		const spotMarket = this.driftClient.getSpotMarketAccount(
			vaultAccount.spotMarketIndex
		);
		const spotOracle = this.driftClient.getOracleDataForSpotMarket(
			vaultAccount.spotMarketIndex
		);
		const spotPrecision = TEN.pow(new BN(spotMarket!.decimals));

		return vaultEquity.mul(spotPrecision).div(spotOracle.price);
	}

	/**
	 * @param params
	 * @returns vault depositor equity, in spot market value (which is usually USDC)
	 */
	public async calculateWithdrawableVaultDepositorEquity(params: {
		vaultDepositorAddress?: PublicKey;
		vaultDepositor?: VaultDepositor;
		vaultAddress?: PublicKey;
		vault?: Vault;
	}): Promise<BN> {
		let vaultAccount: Vault;
		if (params.vaultAddress !== undefined) {
			vaultAccount = await this.program.account.vault.fetch(
				params.vaultAddress
			);
		} else if (params.vault !== undefined) {
			vaultAccount = params.vault;
		} else {
			throw new Error('Must supply vaultAddress or vault');
		}

		let vaultDepositorAccount: VaultDepositor;
		if (params.vaultDepositorAddress !== undefined) {
			vaultDepositorAccount = await this.program.account.vaultDepositor.fetch(
				params.vaultDepositorAddress
			);
		} else if (params.vaultDepositor !== undefined) {
			vaultDepositorAccount = params.vaultDepositor;
		} else {
			throw new Error('Must supply vaultDepositorAddress or vaultDepositor');
		}

		const vaultEquity = await this.calculateVaultEquity({
			vault: vaultAccount,
			factorUnrealizedPNL: false,
		});
		return calculateRealizedVaultDepositorEquity(
			vaultDepositorAccount,
			vaultEquity,
			vaultAccount
		);
	}

	public async calculateWithdrawableVaultDepositorEquityInDepositAsset(params: {
		vaultDepositorAddress?: PublicKey;
		vaultDepositor?: VaultDepositor;
		vaultAddress?: PublicKey;
		vault?: Vault;
	}): Promise<BN> {
		let vaultAccount: Vault;
		if (params.vaultAddress !== undefined) {
			vaultAccount = await this.program.account.vault.fetch(
				params.vaultAddress
			);
		} else if (params.vault !== undefined) {
			vaultAccount = params.vault;
		} else {
			throw new Error('Must supply vaultAddress or vault');
		}

		let vaultDepositorAccount: VaultDepositor;
		if (params.vaultDepositorAddress !== undefined) {
			vaultDepositorAccount = await this.program.account.vaultDepositor.fetch(
				params.vaultDepositorAddress
			);
		} else if (params.vaultDepositor !== undefined) {
			vaultDepositorAccount = params.vaultDepositor;
		} else {
			throw new Error('Must supply vaultDepositorAddress or vaultDepositor');
		}

		let vaultProtocol: VaultProtocol | undefined = undefined;
		if (!vaultAccount.vaultProtocol.equals(SystemProgram.programId)) {
			vaultProtocol = await this.program.account.vaultProtocol.fetch(
				vaultAccount.vaultProtocol
			);
		}

		const vaultEquity = await this.calculateVaultEquity({
			vault: vaultAccount,
			factorUnrealizedPNL: false,
		});
		const vdEquity = calculateRealizedVaultDepositorEquity(
			vaultDepositorAccount,
			vaultEquity,
			vaultAccount,
			vaultProtocol
		);

		const spotMarket = this.driftClient.getSpotMarketAccount(
			vaultAccount.spotMarketIndex
		);
		const spotOracle = this.driftClient.getOracleDataForSpotMarket(
			vaultAccount.spotMarketIndex
		);
		const spotPrecision = TEN.pow(new BN(spotMarket!.decimals));

		return vdEquity.mul(spotPrecision).div(spotOracle.price);
	}

	public async calculateVaultProtocolEquity(params: {
		vault: PublicKey;
	}): Promise<BN> {
		const vaultAccount = await this.program.account.vault.fetch(params.vault);
		const vaultTotalEquity = await this.calculateVaultEquity({
			vault: vaultAccount,
		});
		const vaultProtocol = this.getVaultProtocolAddress(params.vault);
		const vpAccount = await this.program.account.vaultProtocol.fetch(
			vaultProtocol
		);
		return depositSharesToVaultAmount(
			vpAccount.protocolProfitAndFeeShares,
			vaultAccount.totalShares,
			vaultTotalEquity
		);
	}

	public async initializeVault(params: {
		name: number[];
		spotMarketIndex: number;
		redeemPeriod: BN;
		maxTokens: BN;
		minDepositAmount: BN;
		managementFee: BN;
		profitShare: number;
		hurdleRate: number;
		permissioned: boolean;
		vaultProtocol?: VaultProtocolParams;
	}): Promise<TransactionSignature> {
		// This is a workaround to make client backwards compatible.
		// VaultProtocol is optionally undefined, but the anchor type is optionally null.
		// Old clients will default to undefined which prevents old clients from having to pass in a null value.
		// Instead, we can cast to null internally.
		const _params: VaultParams = {
			...params,
			vaultProtocol: params.vaultProtocol ? params.vaultProtocol : null,
		};

		const vault = getVaultAddressSync(this.program.programId, params.name);
		const tokenAccount = getTokenVaultAddressSync(
			this.program.programId,
			vault
		);

		const driftState = await this.driftClient.getStatePublicKey();
		const spotMarket = this.driftClient.getSpotMarketAccount(
			params.spotMarketIndex
		);
		if (!spotMarket) {
			throw new Error(
				`Spot market ${params.spotMarketIndex} not found on driftClient`
			);
		}

		const userStatsKey = getUserStatsAccountPublicKey(
			this.driftClient.program.programId,
			vault
		);
		const userKey = getUserAccountPublicKeySync(
			this.driftClient.program.programId,
			vault
		);

		const accounts = {
			driftSpotMarket: spotMarket.pubkey,
			driftSpotMarketMint: spotMarket.mint,
			driftUserStats: userStatsKey,
			driftUser: userKey,
			driftState,
			vault,
			tokenAccount,
			driftProgram: this.driftClient.program.programId,
		};

		if (params.vaultProtocol) {
			const vaultProtocol = this.getVaultProtocolAddress(
				getVaultAddressSync(this.program.programId, params.name)
			);
			const remainingAccounts: AccountMeta[] = [
				{
					pubkey: vaultProtocol,
					isSigner: false,
					isWritable: true,
				},
			];
			return await this.program.methods
				.initializeVault(_params)
				.accounts(accounts)
				.remainingAccounts(remainingAccounts)
				.rpc();
		} else {
			return await this.program.methods
				.initializeVault(_params)
				.accounts(accounts)
				.rpc();
		}
	}

	/**
	 * Updates the delegate address for a vault. The delegate address will be allowed to trade
	 * on behalf of the vault.
	 * @param vault vault address to update
	 * @param delegate delegate address to update to
	 * @returns
	 */
	public async updateDelegate(
		vault: PublicKey,
		delegate: PublicKey
	): Promise<TransactionSignature> {
		const vaultAccount = await this.program.account.vault.fetch(vault);
		return await this.program.methods
			.updateDelegate(delegate)
			.accounts({
				vault: vault,
				driftUser: vaultAccount.user,
				driftProgram: this.driftClient.program.programId,
			})
			.rpc();
	}

	/**
	 * Updates the vault margin trading status.
	 * @param vault vault address to update
	 * @param enabled whether to enable margin trading
	 * @returns
	 */
	public async updateMarginTradingEnabled(
		vault: PublicKey,
		enabled: boolean
	): Promise<TransactionSignature> {
		const vaultAccount = await this.program.account.vault.fetch(vault);
		return await this.program.methods
			.updateMarginTradingEnabled(enabled)
			.accounts({
				vault: vault,
				driftUser: vaultAccount.user,
				driftProgram: this.driftClient.program.programId,
			})
			.rpc();
	}

	/**
	 *
	 * @param vault vault address to deposit to
	 * @param amount amount to deposit
	 * @returns
	 */
	public async managerDeposit(
		vault: PublicKey,
		amount: BN
	): Promise<TransactionSignature> {
		const vaultAccount = await this.program.account.vault.fetch(vault);
		const driftSpotMarket = this.driftClient.getSpotMarketAccount(
			vaultAccount.spotMarketIndex
		);
		if (!driftSpotMarket) {
			throw new Error(
				`Spot market ${vaultAccount.spotMarketIndex} not found on driftClient`
			);
		}

		const user = await this.getSubscribedVaultUser(vaultAccount.user);

		const remainingAccounts = this.driftClient.getRemainingAccounts({
			userAccounts: [user.getUserAccount()],
			writableSpotMarketIndexes: [vaultAccount.spotMarketIndex],
		});

		return await this.program.methods
			.managerDeposit(amount)
			.accounts({
				vault,
				vaultTokenAccount: vaultAccount.tokenAccount,
				driftUser: await getUserAccountPublicKey(
					this.driftClient.program.programId,
					vault
				),
				driftProgram: this.driftClient.program.programId,
				driftUserStats: getUserStatsAccountPublicKey(
					this.driftClient.program.programId,
					vault
				),
				driftState: await this.driftClient.getStatePublicKey(),
				driftSpotMarketVault: driftSpotMarket.vault,
				userTokenAccount: getAssociatedTokenAddressSync(
					driftSpotMarket.mint,
					this.driftClient.wallet.publicKey
				),
				tokenProgram: TOKEN_PROGRAM_ID,
			})
			.remainingAccounts(remainingAccounts)
			.rpc();
	}

	public async managerRequestWithdraw(
		vault: PublicKey,
		amount: BN,
		withdrawUnit: WithdrawUnit
	): Promise<TransactionSignature> {
		this.program.idl.types;
		// @ts-ignore
		const vaultAccount = (await this.program.account.vault.fetch(
			vault
		)) as Vault;

		if (!this.driftClient.wallet.publicKey.equals(vaultAccount.manager)) {
			throw new Error(`Only the manager of the vault can request a withdraw.`);
		}

		const user = await this.getSubscribedVaultUser(vaultAccount.user);
		const remainingAccounts = this.driftClient.getRemainingAccounts({
			userAccounts: [user.getUserAccount()],
			writableSpotMarketIndexes: [vaultAccount.spotMarketIndex],
		});

		const userStatsKey = getUserStatsAccountPublicKey(
			this.driftClient.program.programId,
			vault
		);

		const driftStateKey = await this.driftClient.getStatePublicKey();

		const accounts = {
			vault,
			driftUserStats: userStatsKey,
			driftUser: vaultAccount.user,
			driftState: driftStateKey,
		};

		if (this.cliMode) {
			return await this.program.methods
				// @ts-ignore, 0.29.0 anchor issues..
				.managerRequestWithdraw(amount, withdrawUnit)
				.accounts(accounts)
				.remainingAccounts(remainingAccounts)
				.rpc();
		} else {
			const requestWithdrawIx = this.program.instruction.managerRequestWithdraw(
				// @ts-ignore
				amount,
				withdrawUnit,
				{
					accounts: {
						manager: this.driftClient.wallet.publicKey,
						...accounts,
					},
					remainingAccounts,
				}
			);

			return await this.createAndSendTxn([requestWithdrawIx]);
		}
	}

	public async managerCancelWithdrawRequest(
		vault: PublicKey
	): Promise<TransactionSignature> {
		const vaultAccount = await this.program.account.vault.fetch(vault);

		const userStatsKey = getUserStatsAccountPublicKey(
			this.driftClient.program.programId,
			vault
		);

		const driftStateKey = await this.driftClient.getStatePublicKey();

		const accounts = {
			manager: this.driftClient.wallet.publicKey,
			vault,
			driftUserStats: userStatsKey,
			driftUser: vaultAccount.user,
			driftState: driftStateKey,
		};

		const user = await this.getSubscribedVaultUser(vaultAccount.user);
		const remainingAccounts = this.driftClient.getRemainingAccounts({
			userAccounts: [user.getUserAccount()],
		});

		if (this.cliMode) {
			return await this.program.methods
				.mangerCancelWithdrawRequest()
				.accounts(accounts)
				.remainingAccounts(remainingAccounts)
				.rpc();
		} else {
			const cancelRequestWithdrawIx =
				this.program.instruction.mangerCancelWithdrawRequest({
					accounts: {
						...accounts,
						manager: this.driftClient.wallet.publicKey,
					},
					remainingAccounts,
				});

			return await this.createAndSendTxn([cancelRequestWithdrawIx]);
		}
	}

	public async managerWithdraw(
		vault: PublicKey
	): Promise<TransactionSignature> {
		const vaultAccount = await this.program.account.vault.fetch(vault);

		if (!this.driftClient.wallet.publicKey.equals(vaultAccount.manager)) {
			throw new Error(`Only the manager of the vault can request a withdraw.`);
		}

		const user = await this.getSubscribedVaultUser(vaultAccount.user);

		const remainingAccounts = this.driftClient.getRemainingAccounts({
			userAccounts: [user.getUserAccount()],
			writableSpotMarketIndexes: [vaultAccount.spotMarketIndex],
		});

		const spotMarket = this.driftClient.getSpotMarketAccount(
			vaultAccount.spotMarketIndex
		);
		if (!spotMarket) {
			throw new Error(
				`Spot market ${vaultAccount.spotMarketIndex} not found on driftClient`
			);
		}

		const ix = this.program.instruction.managerWithdraw({
			accounts: {
				vault,
				manager: this.driftClient.wallet.publicKey,
				vaultTokenAccount: vaultAccount.tokenAccount,
				driftUser: await getUserAccountPublicKey(
					this.driftClient.program.programId,
					vault
				),
				driftProgram: this.driftClient.program.programId,
				driftUserStats: getUserStatsAccountPublicKey(
					this.driftClient.program.programId,
					vault
				),
				driftState: await this.driftClient.getStatePublicKey(),
				driftSpotMarketVault: spotMarket.vault,
				userTokenAccount: getAssociatedTokenAddressSync(
					spotMarket.mint,
					this.driftClient.wallet.publicKey
				),
				driftSigner: this.driftClient.getStateAccount().signer,
				tokenProgram: TOKEN_PROGRAM_ID,
			},
			remainingAccounts,
		});
		return this.createAndSendTxn([ix], {
			cuLimit: 1_000_000,
		});
	}

	public async managerUpdateVault(
		vault: PublicKey,
		params: {
			redeemPeriod: BN | null;
			maxTokens: BN | null;
			managementFee: BN | null;
			minDepositAmount: BN | null;
			profitShare: number | null;
			hurdleRate: number | null;
			permissioned: boolean | null;
			vaultProtocol?: UpdateVaultProtocolParams;
		}
	): Promise<TransactionSignature> {
		// this is a workaround to make client backwards compatible.
		// vaultProtocol is optionally undefined, but the anchor type is optionally null.
		// Old clients will default to undefined, and we can cast to null internally.
		const _params: UpdateVaultParams = {
			...params,
			vaultProtocol: params.vaultProtocol ? params.vaultProtocol : null,
		};
		const ix = this.program.instruction.updateVault(_params, {
			accounts: {
				vault,
				manager: this.driftClient.wallet.publicKey,
			},
		});
		return this.createAndSendTxn([ix], {
			cuLimit: 600_000,
			cuPriceMicroLamports: 10_000,
		});
	}

	public async getApplyProfitShareIx(
		vault: PublicKey,
		vaultDepositor: PublicKey
	): Promise<TransactionInstruction> {
		const vaultAccount = await this.program.account.vault.fetch(vault);

		const user = await this.getSubscribedVaultUser(vaultAccount.user);

		const spotMarket = this.driftClient.getSpotMarketAccount(
			vaultAccount.spotMarketIndex
		);
		if (!spotMarket) {
			throw new Error(
				`Spot market ${vaultAccount.spotMarketIndex} not found on driftClient`
			);
		}

		const remainingAccounts = this.driftClient.getRemainingAccounts({
			userAccounts: [user.getUserAccount()],
			writableSpotMarketIndexes: [vaultAccount.spotMarketIndex],
		});

		const accounts = {
			vault,
			vaultDepositor,
			manager: this.driftClient.wallet.publicKey,
			driftUserStats: getUserStatsAccountPublicKey(
				this.driftClient.program.programId,
				vault
			),
			driftUser: await getUserAccountPublicKey(
				this.driftClient.program.programId,
				vault
			),
			driftState: await this.driftClient.getStatePublicKey(),
			driftSigner: this.driftClient.getStateAccount().signer,
			driftProgram: this.driftClient.program.programId,
		};

		return this.program.instruction.applyProfitShare({
			accounts: {
				...accounts,
			},
			remainingAccounts,
		});
	}

	private createInitVaultDepositorIx(vault: PublicKey, authority?: PublicKey) {
		const vaultDepositor = getVaultDepositorAddressSync(
			this.program.programId,
			vault,
			authority || this.driftClient.wallet.publicKey
		);

		const accounts = {
			vaultDepositor,
			vault,
			authority: authority || this.driftClient.wallet.publicKey,
		};

		const initIx = this.program.instruction.initializeVaultDepositor({
			accounts: {
				...accounts,
				payer: authority || this.driftClient.wallet.publicKey,
				rent: SYSVAR_RENT_PUBKEY,
				systemProgram: SystemProgram.programId,
			},
		});

		return initIx;
	}

	/**
	 * Initializes the vault depositor account. This account is used to deposit funds into a vault.
	 * @param vault the vault address to deposit into
	 * @param authority the authority allowed to make deposits into the vault
	 * @returns
	 */
	public async initializeVaultDepositor(
		vault: PublicKey,
		authority?: PublicKey
	): Promise<TransactionSignature> {
		const vaultDepositor = getVaultDepositorAddressSync(
			this.program.programId,
			vault,
			authority || this.driftClient.wallet.publicKey
		);

		const accounts = {
			vaultDepositor,
			vault,
			authority: authority || this.driftClient.wallet.publicKey,
		};

		if (this.cliMode) {
			return await this.program.methods
				.initializeVaultDepositor()
				.accounts(accounts)
				.rpc();
		} else {
			const initIx = this.createInitVaultDepositorIx(vault, authority);
			return await this.createAndSendTxn([initIx]);
		}
	}

	public async prepDepositTx(
		vaultDepositor: PublicKey,
		amount: BN,
		initVaultDepositor?: {
			authority: PublicKey;
			vault: PublicKey;
		}
	) {
		let vaultPubKey: PublicKey;
		if (initVaultDepositor) {
			vaultPubKey = initVaultDepositor.vault;
		} else {
			const vaultDepositorAccount =
				await this.program.account.vaultDepositor.fetch(vaultDepositor);
			vaultPubKey = vaultDepositorAccount.vault;
		}

		const vaultAccount = await this.program.account.vault.fetch(vaultPubKey);

		const user = await this.getSubscribedVaultUser(vaultAccount.user);
		const remainingAccounts = this.driftClient.getRemainingAccounts({
			userAccounts: [user.getUserAccount()],
			writableSpotMarketIndexes: [vaultAccount.spotMarketIndex],
		});

		const userStatsKey = getUserStatsAccountPublicKey(
			this.driftClient.program.programId,
			vaultPubKey
		);

		const driftStateKey = await this.driftClient.getStatePublicKey();

		const spotMarket = this.driftClient.getSpotMarketAccount(
			vaultAccount.spotMarketIndex
		);
		if (!spotMarket) {
			throw new Error(
				`Spot market ${vaultAccount.spotMarketIndex} not found on driftClient`
			);
		}

		const accounts = {
			vault: vaultPubKey,
			vaultDepositor,
			vaultTokenAccount: vaultAccount.tokenAccount,
			driftUserStats: userStatsKey,
			driftUser: vaultAccount.user,
			driftState: driftStateKey,
			driftSpotMarketVault: spotMarket.vault,
			userTokenAccount: getAssociatedTokenAddressSync(
				spotMarket.mint,
				this.driftClient.wallet.publicKey,
				true
			),
			driftProgram: this.driftClient.program.programId,
			tokenProgram: TOKEN_PROGRAM_ID,
		};

		return {
			vaultAccount,
			accounts,
			remainingAccounts,
		};
	}

	public async createDepositTx(
		vaultDepositor: PublicKey,
		amount: BN,
		initVaultDepositor?: {
			authority: PublicKey;
			vault: PublicKey;
		},
		txParams?: TxParams
	): Promise<VersionedTransaction> {
		const { vaultAccount, accounts, remainingAccounts } =
			await this.prepDepositTx(vaultDepositor, amount, initVaultDepositor);

		const depositIx = this.program.instruction.deposit(amount, {
			accounts: {
				authority: this.driftClient.wallet.publicKey,
				...accounts,
			},
			remainingAccounts,
		});

		if (initVaultDepositor) {
			const initIx = this.createInitVaultDepositorIx(
				vaultAccount.pubkey,
				initVaultDepositor.authority
			);
			return await this.createTxn([initIx, depositIx], txParams);
		} else {
			return await this.createTxn([depositIx], txParams);
		}
	}

	/**
	 * Depositor funds into the specified vault.
	 * @param vaultDepositor
	 * @param amount
	 * @param initVaultDepositor If true, will initialize the vault depositor account
	 * @returns
	 */
	public async deposit(
		vaultDepositor: PublicKey,
		amount: BN,
		initVaultDepositor?: {
			authority: PublicKey;
			vault: PublicKey;
		},
		txParams?: TxParams
	): Promise<TransactionSignature> {
		if (this.cliMode) {
			const { vaultAccount, accounts, remainingAccounts } =
				await this.prepDepositTx(vaultDepositor, amount, initVaultDepositor);

			if (initVaultDepositor) {
				await this.initializeVaultDepositor(
					vaultAccount.pubkey,
					initVaultDepositor.authority
				);
			}
			return await this.program.methods
				.deposit(amount)
				.accounts(accounts)
				.remainingAccounts(remainingAccounts)
				.rpc();
		} else {
			const depositTxn = await this.createDepositTx(
				vaultDepositor,
				amount,
				initVaultDepositor,
				txParams
			);

			return this.sendTxn(depositTxn, txParams?.simulateTransaction);
		}
	}

	public async requestWithdraw(
		vaultDepositor: PublicKey,
		amount: BN,
		withdrawUnit: WithdrawUnit,
		txParams?: TxParams
	): Promise<TransactionSignature> {
		const vaultDepositorAccount =
			await this.program.account.vaultDepositor.fetch(vaultDepositor);
		const vaultAccount = await this.program.account.vault.fetch(
			vaultDepositorAccount.vault
		);

		const user = await this.getSubscribedVaultUser(vaultAccount.user);
		const remainingAccounts = this.driftClient.getRemainingAccounts({
			userAccounts: [user.getUserAccount()],
		});
		if (!vaultAccount.vaultProtocol.equals(SystemProgram.programId)) {
			const vaultProtocol = this.getVaultProtocolAddress(
				vaultDepositorAccount.vault
			);
			remainingAccounts.push({
				pubkey: vaultProtocol,
				isSigner: false,
				isWritable: true,
			});
		}

		const userStatsKey = getUserStatsAccountPublicKey(
			this.driftClient.program.programId,
			vaultDepositorAccount.vault
		);

		const driftStateKey = await this.driftClient.getStatePublicKey();

		const accounts = {
			vault: vaultDepositorAccount.vault,
			vaultDepositor,
			driftUserStats: userStatsKey,
			driftUser: vaultAccount.user,
			driftState: driftStateKey,
		};

		if (this.cliMode) {
			return await this.program.methods
				// @ts-ignore
				.requestWithdraw(amount, withdrawUnit)
				.accounts(accounts)
				.remainingAccounts(remainingAccounts)
				.rpc();
		} else {
			const requestWithdrawIx = this.program.instruction.requestWithdraw(
				// @ts-ignore
				amount,
				withdrawUnit,
				{
					accounts: {
						authority: this.driftClient.wallet.publicKey,
						...accounts,
					},
					remainingAccounts,
				}
			);

			return await this.createAndSendTxn([requestWithdrawIx], txParams);
		}
	}

	public async withdraw(
		vaultDepositor: PublicKey,
		txParams?: TxParams
	): Promise<TransactionSignature> {
		const vaultDepositorAccount =
			await this.program.account.vaultDepositor.fetch(vaultDepositor);
		const vaultAccount = await this.program.account.vault.fetch(
			vaultDepositorAccount.vault
		);

		const user = await this.getSubscribedVaultUser(vaultAccount.user);
		const remainingAccounts = this.driftClient.getRemainingAccounts({
			userAccounts: [user.getUserAccount()],
			writableSpotMarketIndexes: [vaultAccount.spotMarketIndex],
		});
		const vaultProtocol = this.getVaultProtocolAddress(
			vaultDepositorAccount.vault
		);
		if (!vaultProtocol.equals(SystemProgram.programId)) {
			remainingAccounts.push({
				pubkey: vaultProtocol,
				isSigner: false,
				isWritable: true,
			});
		}

		const userStatsKey = getUserStatsAccountPublicKey(
			this.driftClient.program.programId,
			vaultDepositorAccount.vault
		);

		const driftStateKey = await this.driftClient.getStatePublicKey();

		const spotMarket = this.driftClient.getSpotMarketAccount(
			vaultAccount.spotMarketIndex
		);
		if (!spotMarket) {
			throw new Error(
				`Spot market ${vaultAccount.spotMarketIndex} not found on driftClient`
			);
		}

		const userAta = getAssociatedTokenAddressSync(
			spotMarket.mint,
			this.driftClient.wallet.publicKey,
			true
		);

		let createAtaIx: TransactionInstruction | undefined = undefined;
		const userAtaExists = await this.driftClient.connection.getAccountInfo(
			userAta
		);
		if (userAtaExists === null) {
			createAtaIx = createAssociatedTokenAccountInstruction(
				this.driftClient.wallet.publicKey,
				userAta,
				this.driftClient.wallet.publicKey,
				spotMarket.mint
			);
		}

		const accounts = {
			vault: vaultDepositorAccount.vault,
			vaultDepositor,
			vaultTokenAccount: vaultAccount.tokenAccount,
			driftUserStats: userStatsKey,
			driftUser: vaultAccount.user,
			driftState: driftStateKey,
			driftSpotMarketVault: spotMarket.vault,
			driftSigner: this.driftClient.getStateAccount().signer,
			userTokenAccount: userAta,
			driftProgram: this.driftClient.program.programId,
			tokenProgram: TOKEN_PROGRAM_ID,
		};

		if (this.cliMode) {
			if (createAtaIx) {
				return await this.program.methods
					.withdraw()
					.accounts(accounts)
					.remainingAccounts(remainingAccounts)
					.preInstructions([createAtaIx])
					.rpc();
			} else {
				return await this.program.methods
					.withdraw()
					.accounts(accounts)
					.remainingAccounts(remainingAccounts)
					.rpc();
			}
		} else {
			const ixs = [
				await this.program.methods
					.withdraw()
					.accounts({
						authority: this.driftClient.wallet.publicKey,
						...accounts,
					})
					.remainingAccounts(remainingAccounts)
					.instruction(),
			];
			if (createAtaIx) {
				ixs.unshift(createAtaIx);
			}

			return await this.createAndSendTxn(ixs, {
				cuLimit: (txParams?.cuLimit ?? 650_000) + (createAtaIx ? 100_000 : 0),
				...txParams,
			});
		}
	}

	public async forceWithdraw(
		vaultDepositor: PublicKey
	): Promise<TransactionSignature> {
		const vaultDepositorAccount =
			await this.program.account.vaultDepositor.fetch(vaultDepositor);
		const vaultAccount = await this.program.account.vault.fetch(
			vaultDepositorAccount.vault
		);

		const user = await this.getSubscribedVaultUser(vaultAccount.user);
		const remainingAccounts = this.driftClient.getRemainingAccounts({
			userAccounts: [user.getUserAccount()],
			writableSpotMarketIndexes: [vaultAccount.spotMarketIndex],
		});

		const userStatsKey = getUserStatsAccountPublicKey(
			this.driftClient.program.programId,
			vaultDepositorAccount.vault
		);

		const driftStateKey = await this.driftClient.getStatePublicKey();

		const spotMarket = this.driftClient.getSpotMarketAccount(
			vaultAccount.spotMarketIndex
		);
		if (!spotMarket) {
			throw new Error(
				`Spot market ${vaultAccount.spotMarketIndex} not found on driftClient`
			);
		}

		const accounts = {
			manager: this.driftClient.wallet.publicKey,
			vault: vaultDepositorAccount.vault,
			vaultDepositor,
			vaultTokenAccount: vaultAccount.tokenAccount,
			driftUserStats: userStatsKey,
			driftUser: vaultAccount.user,
			driftState: driftStateKey,
			driftSpotMarketVault: spotMarket.vault,
			driftSigner: this.driftClient.getStateAccount().signer,
			userTokenAccount: getAssociatedTokenAddressSync(
				spotMarket.mint,
				vaultDepositorAccount.authority,
				true
			),
			driftProgram: this.driftClient.program.programId,
			tokenProgram: TOKEN_PROGRAM_ID,
		};

		if (this.cliMode) {
			return await this.program.methods
				.forceWithdraw()
				.preInstructions([
					ComputeBudgetProgram.setComputeUnitLimit({
						units: 500_000,
					}),
					ComputeBudgetProgram.setComputeUnitPrice({
						microLamports: 50_000,
					}),
				])
				.accounts(accounts)
				.remainingAccounts(remainingAccounts)
				.rpc();
		} else {
			const forceWithdrawIx = this.program.instruction.forceWithdraw({
				accounts: {
					...accounts,
				},
				remainingAccounts,
			});
			return await this.createAndSendTxn([forceWithdrawIx]);
		}
	}

	public async cancelRequestWithdraw(
		vaultDepositor: PublicKey,
		txParams?: TxParams
	): Promise<TransactionSignature> {
		const vaultDepositorAccount =
			await this.program.account.vaultDepositor.fetch(vaultDepositor);
		const vaultAccount = await this.program.account.vault.fetch(
			vaultDepositorAccount.vault
		);

		const userStatsKey = getUserStatsAccountPublicKey(
			this.driftClient.program.programId,
			vaultDepositorAccount.vault
		);

		const driftStateKey = await this.driftClient.getStatePublicKey();

		const accounts = {
			vault: vaultDepositorAccount.vault,
			vaultDepositor,
			driftUserStats: userStatsKey,
			driftUser: vaultAccount.user,
			driftState: driftStateKey,
		};

		const user = await this.getSubscribedVaultUser(vaultAccount.user);
		const remainingAccounts = this.driftClient.getRemainingAccounts({
			userAccounts: [user.getUserAccount()],
		});

		if (this.cliMode) {
			return await this.program.methods
				.cancelRequestWithdraw()
				.accounts(accounts)
				.remainingAccounts(remainingAccounts)
				.rpc();
		} else {
			const cancelRequestWithdrawIx =
				this.program.instruction.cancelRequestWithdraw({
					accounts: {
						authority: this.driftClient.wallet.publicKey,
						...accounts,
					},
					remainingAccounts,
				});

			return await this.createAndSendTxn([cancelRequestWithdrawIx], txParams);
		}
	}

	/**
	 * Liquidates (become delegate for) a vault.
	 * @param
	 * @param
	 * @returns
	 */
	public async liquidate(
		vaultDepositor: PublicKey,
		txParams?: TxParams
	): Promise<TransactionSignature> {
		const vaultDepositorAccount =
			await this.program.account.vaultDepositor.fetch(vaultDepositor);
		const vaultPubKey = vaultDepositorAccount.vault;

		const vaultAccount = await this.program.account.vault.fetch(vaultPubKey);

		const user = await this.getSubscribedVaultUser(vaultAccount.user);
		const remainingAccounts = this.driftClient.getRemainingAccounts({
			userAccounts: [user.getUserAccount()],
			writableSpotMarketIndexes: [vaultAccount.spotMarketIndex],
		});

		const userStatsKey = getUserStatsAccountPublicKey(
			this.driftClient.program.programId,
			vaultPubKey
		);

		const driftStateKey = await this.driftClient.getStatePublicKey();

		const accounts = {
			vault: vaultPubKey,
			vaultDepositor,
			vaultTokenAccount: vaultAccount.tokenAccount,
			driftUserStats: userStatsKey,
			driftUser: vaultAccount.user,
			driftState: driftStateKey,
			driftProgram: this.driftClient.program.programId,
		};

		if (this.cliMode) {
			return await this.program.methods
				.liquidate()
				.accounts(accounts)
				.remainingAccounts(remainingAccounts)
				.rpc();
		} else {
			const liquidateIx = this.program.instruction.liquidate({
				accounts: {
					authority: this.driftClient.wallet.publicKey,
					...accounts,
				},
				remainingAccounts,
			});

			return await this.createAndSendTxn([liquidateIx], txParams);
		}
	}

	public async createTxn(
		vaultIxs: TransactionInstruction[],
		txParams?: TxParams
	): Promise<VersionedTransaction> {
		const ixs = [
			ComputeBudgetProgram.setComputeUnitLimit({
				units: txParams?.cuLimit ?? 400_000,
			}),
			ComputeBudgetProgram.setComputeUnitPrice({
				microLamports: txParams?.cuPriceMicroLamports ?? 1_000_000,
			}),
			...vaultIxs,
		];

		return (await this.driftClient.txHandler.buildTransaction({
			connection: this.driftClient.connection,
			instructions: ixs,
			lookupTables: txParams?.lookupTables ?? [],
			preFlightCommitment: 'confirmed',
			forceVersionedTransaction: true,
			txVersion: 0,
			fetchMarketLookupTableAccount:
				this.driftClient.fetchMarketLookupTableAccount.bind(this.driftClient),
		})) as VersionedTransaction;
	}

	public async sendTxn(
		transaction: VersionedTransaction,
		simulateTransaction?: boolean
	): Promise<TransactionSignature> {
		let txSig = bs58.encode(transaction.signatures[0]);
		if (simulateTransaction) {
			try {
				const resp = await this.driftClient.connection.simulateTransaction(
					transaction,
					{
						sigVerify: false,
						commitment: this.driftClient.connection.commitment,
					}
				);
				console.log(`Simulated transaction:\n${JSON.stringify(resp, null, 2)}`);
			} catch (e) {
				const err = e as Error;
				console.error(
					`Error simulating transaction: ${err.message}\n:${err.stack ?? ''}`
				);
			}
		} else {
			const resp = await this.driftClient.sendTransaction(
				transaction,
				[],
				this.driftClient.opts
			);
			if (resp.txSig !== txSig) {
				console.error(
					`Transaction signature mismatch with self calculated value: ${resp.txSig} !== ${txSig}`
				);
				txSig = resp.txSig;
			}
		}

		return txSig!;
	}

	/**
	 * Used for UI wallet adapters compatibility
	 */
	public async createAndSendTxn(
		vaultIxs: TransactionInstruction[],
		txParams?: TxParams
	): Promise<TransactionSignature> {
		const tx = await this.createTxn(vaultIxs, txParams);
		const txSig = await this.sendTxn(tx, txParams?.simulateTransaction);

		return txSig;
	}

	/**
	 * Initializes an insurance fund stake for the vault.
	 * @param vault vault address to update
	 * @param spotMarketIndex spot market index of the insurance fund stake
	 * @returns
	 */
	public async initializeInsuranceFundStake(
		vault: PublicKey,
		spotMarketIndex: number
	): Promise<TransactionSignature> {
		const vaultAccount = await this.program.account.vault.fetch(vault);

		const ifStakeAccountPublicKey = getInsuranceFundStakeAccountPublicKey(
			this.driftClient.program.programId,
			vault,
			spotMarketIndex
		);

		const spotMarket = this.driftClient.getSpotMarketAccount(spotMarketIndex);
		if (!spotMarket) {
			throw new Error(
				`Spot market ${spotMarketIndex} not found on driftClient`
			);
		}

		return await this.program.methods
			.initializeInsuranceFundStake(spotMarketIndex)
			.accounts({
				vault: vault,
				driftSpotMarket: spotMarket.pubkey,
				insuranceFundStake: ifStakeAccountPublicKey,
				driftUserStats: vaultAccount.userStats,
				driftState: await this.driftClient.getStatePublicKey(),
				driftProgram: this.driftClient.program.programId,
			})
			.rpc();
	}

	/**
	 * Initializes a DriftCompetitions Competitor account for the vault.
	 * @param vault vault address to initialize Competitor for
	 * @param competitionName name of the competition to initialize for
	 * @returns
	 */
	public async initializeCompetitor(
		vault: PublicKey,
		competitionsClient: CompetitionsClient,
		competitionName: string
	): Promise<TransactionSignature> {
		const vaultAccount = await this.program.account.vault.fetch(vault);

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

		return await this.program.methods
			.initializeCompetitor()
			.accounts({
				vault: vault,
				competitor: competitorAddress,
				driftCompetitions: competitionAddress,
				driftUserStats: vaultAccount.userStats,
				driftCompetitionsProgram: competitionsClient.program.programId,
			})
			.rpc();
	}
}
