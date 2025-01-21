import {
	BN,
	DriftClient,
	getInsuranceFundStakeAccountPublicKey,
	getUserAccountPublicKey,
	getUserAccountPublicKeySync,
	getUserStatsAccountPublicKey,
	TEN,
	UserMap,
	unstakeSharesToAmount as depositSharesToVaultAmount,
	ZERO,
	getInsuranceFundVaultPublicKey,
	OracleSource,
	WRAPPED_SOL_MINT,
	SpotMarketAccount,
} from '@drift-labs/sdk';
import { BorshAccountsCoder, Program, ProgramAccount } from '@coral-xyz/anchor';
import { DriftVaults } from './types/drift_vaults';
import {
	getTokenizedVaultAddressSync,
	getTokenizedVaultMintAddressSync,
	getInsuranceFundTokenVaultAddressSync,
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
	Transaction,
	TransactionInstruction,
	TransactionSignature,
	VersionedTransaction,
} from '@solana/web3.js';
import {
	createAssociatedTokenAccountInstruction,
	createCloseAccountInstruction,
	createSyncNativeInstruction,
	getAssociatedTokenAddressSync,
	TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import {
	Vault,
	VaultDepositor,
	VaultParams,
	VaultProtocol,
	VaultProtocolParams,
	VaultWithProtocolParams,
	WithdrawUnit,
} from './types/types';
import { bs58 } from '@coral-xyz/anchor/dist/cjs/utils/bytes';
import { UserMapConfig } from '@drift-labs/sdk';
import { calculateRealizedVaultDepositorEquity } from './math';
import { Metaplex } from '@metaplex-foundation/js';
import { getOrCreateATAInstruction } from './utils';

export type TxParams = {
	cuLimit?: number;
	cuPriceMicroLamports?: number;
	simulateTransaction?: boolean;
	lookupTables?: AddressLookupTableAccount[];
	oracleFeedsToCrank?: { feed: PublicKey; oracleSource: OracleSource }[];
};

export class VaultClient {
	driftClient: DriftClient;
	metaplex?: Metaplex;
	program: Program<DriftVaults>;
	cliMode: boolean;

	/**
	 * Cache map of drift user accounts of vaults.
	 */
	readonly vaultUsers: UserMap;

	constructor({
		driftClient,
		program,
		metaplex,
		cliMode,
		userMapConfig,
	}: {
		driftClient: DriftClient;
		program: Program<DriftVaults>;
		metaplex?: Metaplex;
		cliMode?: boolean;
		userMapConfig?: UserMapConfig;
	}) {
		this.driftClient = driftClient;
		this.metaplex = metaplex;
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

	/**
	 * Unsubscribes from the vault users map. Call this to clean up any dangling promises.
	 */
	public async unsubscribe() {
		await this.vaultUsers.unsubscribe();
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
		try {
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
		} catch (err) {
			console.error('VaultClient ~ err:', err);
			return ZERO;
		}
	}

	public async calculateVaultAllTimeNotionalPnl(params: {
		address?: PublicKey;
		vault?: Vault;
	}): Promise<BN> {
		try {
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
			const allTimeTotalPnl = user.getTotalAllTimePnl();

			return allTimeTotalPnl;
		} catch (err) {
			console.error('VaultClient ~ err:', err);
			return ZERO;
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
		if (vaultAccount.vaultProtocol) {
			vaultProtocol = await this.program.account.vaultProtocol.fetch(
				this.getVaultProtocolAddress(vaultAccount.pubkey)
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

	public async initializeVault(
		params: {
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
		},
		uiTxParams?: TxParams
	): Promise<TransactionSignature> {
		const { vaultProtocol: vaultProtocolParams, ...vaultParams } = params;
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

		const preIxs = [
			ComputeBudgetProgram.setComputeUnitLimit({
				units: 400_000,
			}),
			ComputeBudgetProgram.setComputeUnitPrice({
				microLamports: 300_000,
			}),
		];

		if (vaultProtocolParams) {
			const vaultProtocol = this.getVaultProtocolAddress(
				getVaultAddressSync(this.program.programId, params.name)
			);
			const _params: VaultWithProtocolParams = {
				...vaultParams,
				vaultProtocol: vaultProtocolParams,
			};

			if (this.cliMode) {
				return await this.program.methods
					.initializeVaultWithProtocol(_params)
					.preInstructions(preIxs)
					.accounts({
						...accounts,
						vaultProtocol,
					})
					.rpc();
			} else {
				const uiAuthority = this.driftClient.wallet.publicKey;
				const initializeVaultWithProtocolIx = await this.program.methods
					.initializeVaultWithProtocol(_params)
					.accounts({
						...accounts,
						vaultProtocol,
						payer: uiAuthority,
						manager: uiAuthority,
					})
					.instruction();
				const ixs = [...preIxs, initializeVaultWithProtocolIx];
				return await this.createAndSendTxn(ixs, uiTxParams);
			}
		} else {
			const _params: VaultParams = vaultParams;

			if (this.cliMode) {
				return await this.program.methods
					.initializeVault(_params)
					.preInstructions(preIxs)
					.accounts(accounts)
					.rpc();
			} else {
				const uiAuthority = this.driftClient.wallet.publicKey;
				const initializeVaultIx = await this.program.methods
					.initializeVault(_params)
					.accounts({
						...accounts,
						payer: uiAuthority,
						manager: uiAuthority,
					})
					.instruction();
				const ixs = [initializeVaultIx];
				return await this.createAndSendTxn(ixs, uiTxParams);
			}
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
		delegate: PublicKey,
		uiTxParams?: TxParams
	): Promise<TransactionSignature> {
		const vaultAccount = await this.program.account.vault.fetch(vault);
		const accounts = {
			vault: vault,
			driftUser: vaultAccount.user,
			driftProgram: this.driftClient.program.programId,
		};

		if (this.cliMode) {
			return await this.program.methods
				.updateDelegate(delegate)
				.preInstructions([
					ComputeBudgetProgram.setComputeUnitLimit({
						units: 400_000,
					}),
					ComputeBudgetProgram.setComputeUnitPrice({
						microLamports: 300_000,
					}),
				])
				.accounts(accounts)
				.rpc();
		} else {
			const updateDelegateIx = await this.program.methods
				.updateDelegate(delegate)
				.accounts({ ...accounts, manager: this.driftClient.wallet.publicKey })
				.instruction();
			return await this.createAndSendTxn([updateDelegateIx], uiTxParams);
		}
	}

	/**
	 * Updates the vault margin trading status.
	 * @param vault vault address to update
	 * @param enabled whether to enable margin trading
	 * @returns
	 */
	public async updateMarginTradingEnabled(
		vault: PublicKey,
		enabled: boolean,
		uiTxParams?: TxParams
	): Promise<TransactionSignature> {
		const vaultAccount = await this.program.account.vault.fetch(vault);
		const accounts = {
			vault: vault,
			driftUser: vaultAccount.user,
			driftProgram: this.driftClient.program.programId,
		};

		const user = await this.getSubscribedVaultUser(vaultAccount.user);

		let remainingAccounts: AccountMeta[] = [];
		try {
			remainingAccounts = this.driftClient.getRemainingAccounts({
				userAccounts: [user.getUserAccount()],
			});
		} catch (err) {
			// do nothing
		}

		if (this.cliMode) {
			return await this.program.methods
				.updateMarginTradingEnabled(enabled)
				.accounts(accounts)
				.remainingAccounts(remainingAccounts)
				.rpc();
		} else {
			const updateMarginTradingEnabledIx = await this.program.methods
				.updateMarginTradingEnabled(enabled)
				.accounts({ ...accounts, manager: this.driftClient.wallet.publicKey })
				.remainingAccounts(remainingAccounts)
				.instruction();
			return await this.createAndSendTxn(
				[updateMarginTradingEnabledIx],
				uiTxParams
			);
		}
	}

	private async handleWSolMovement(
		amount: BN,
		driftSpotMarket: SpotMarketAccount,
		userTokenAccount: PublicKey
	) {
		const isSolDeposit = driftSpotMarket.mint.equals(WRAPPED_SOL_MINT);
		const preIxs: TransactionInstruction[] = [];
		const postIxs: TransactionInstruction[] = [];

		if (isSolDeposit) {
			const { ixs: createWSolAccountIxs, pubkey } =
				await this.driftClient.getWrappedSolAccountCreationIxs(amount, true);

			userTokenAccount = pubkey;

			preIxs.push(...createWSolAccountIxs);
			postIxs.push(
				createCloseAccountInstruction(
					userTokenAccount,
					this.driftClient.wallet.publicKey,
					this.driftClient.wallet.publicKey,
					[]
				)
			);
		}

		return { userTokenAccount, preIxs, postIxs };
	}

	/**
	 *
	 * @param vault vault address to deposit to
	 * @param amount amount to deposit
	 * @returns
	 */
	public async managerDeposit(
		vault: PublicKey,
		amount: BN,
		uiTxParams?: TxParams,
		managerTokenAccount?: PublicKey
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
		if (vaultAccount.vaultProtocol) {
			const vaultProtocol = this.getVaultProtocolAddress(vault);
			remainingAccounts.push({
				pubkey: vaultProtocol,
				isSigner: false,
				isWritable: true,
			});
		}

		const accounts = {
			vault,
			vaultTokenAccount: vaultAccount.tokenAccount,
			driftUser: await getUserAccountPublicKey(
				this.driftClient.program.programId,
				vault
			),
			driftUserStats: getUserStatsAccountPublicKey(
				this.driftClient.program.programId,
				vault
			),
			driftProgram: this.driftClient.program.programId,
			driftState: await this.driftClient.getStatePublicKey(),
			driftSpotMarketVault: driftSpotMarket.vault,
			userTokenAccount:
				managerTokenAccount ??
				getAssociatedTokenAddressSync(
					driftSpotMarket.mint,
					this.driftClient.wallet.publicKey
				),
			tokenProgram: TOKEN_PROGRAM_ID,
		};

		const { userTokenAccount, preIxs, postIxs } = await this.handleWSolMovement(
			amount,
			driftSpotMarket,
			accounts.userTokenAccount
		);

		if (this.cliMode) {
			return await this.program.methods
				.managerDeposit(amount)
				.accounts({ ...accounts, userTokenAccount })
				.remainingAccounts(remainingAccounts)
				.preInstructions(preIxs)
				.postInstructions(postIxs)
				.rpc();
		} else {
			const managerDepositIx = await this.program.methods
				.managerDeposit(amount)
				.accounts({
					...accounts,
					userTokenAccount,
					manager: this.driftClient.wallet.publicKey,
				})
				.remainingAccounts(remainingAccounts)
				.instruction();
			return await this.createAndSendTxn(
				[...preIxs, managerDepositIx, ...postIxs],
				uiTxParams
			);
		}
	}

	public async managerRequestWithdraw(
		vault: PublicKey,
		amount: BN,
		withdrawUnit: WithdrawUnit,
		uiTxParams?: TxParams
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
		if (vaultAccount.vaultProtocol) {
			const vaultProtocol = this.getVaultProtocolAddress(vault);
			remainingAccounts.push({
				pubkey: vaultProtocol,
				isSigner: false,
				isWritable: true,
			});
		}

		const userStatsKey = getUserStatsAccountPublicKey(
			this.driftClient.program.programId,
			vault
		);

		const accounts = {
			vault,
			driftUser: vaultAccount.user,
			driftUserStats: userStatsKey,
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

			return await this.createAndSendTxn([requestWithdrawIx], uiTxParams);
		}
	}

	public async managerCancelWithdrawRequest(
		vault: PublicKey,
		uiTxParams?: TxParams
	): Promise<TransactionSignature> {
		const vaultAccount = await this.program.account.vault.fetch(vault);

		const userStatsKey = getUserStatsAccountPublicKey(
			this.driftClient.program.programId,
			vault
		);

		const accounts = {
			manager: this.driftClient.wallet.publicKey,
			vault,
			driftUser: vaultAccount.user,
			driftUserStats: userStatsKey,
		};

		const user = await this.getSubscribedVaultUser(vaultAccount.user);
		const remainingAccounts = this.driftClient.getRemainingAccounts({
			userAccounts: [user.getUserAccount()],
		});
		if (vaultAccount.vaultProtocol) {
			const vaultProtocol = this.getVaultProtocolAddress(vault);
			remainingAccounts.push({
				pubkey: vaultProtocol,
				isSigner: false,
				isWritable: true,
			});
		}

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
						driftUserStats: getUserStatsAccountPublicKey(
							this.driftClient.program.programId,
							vault
						),
						manager: this.driftClient.wallet.publicKey,
					},
					remainingAccounts,
				});

			return await this.createAndSendTxn([cancelRequestWithdrawIx], uiTxParams);
		}
	}

	public async managerWithdraw(
		vault: PublicKey,
		uiTxParams?: TxParams
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
		if (vaultAccount.vaultProtocol) {
			const vaultProtocol = this.getVaultProtocolAddress(vault);
			remainingAccounts.push({
				pubkey: vaultProtocol,
				isSigner: false,
				isWritable: true,
			});
		}

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
		return this.createAndSendTxn([ix], uiTxParams);
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
		},
		uiTxParams?: TxParams
	): Promise<TransactionSignature> {
		const ix = this.program.instruction.updateVault(params, {
			accounts: {
				vault,
				manager: this.driftClient.wallet.publicKey,
			},
		});
		if (this.cliMode) {
			return this.createAndSendTxn([ix], {
				cuLimit: 600_000,
				cuPriceMicroLamports: 10_000,
			});
		} else {
			return this.createAndSendTxn([ix], uiTxParams);
		}
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

	public async getApplyRebaseTokenizedDepositorIx(
		vault: PublicKey,
		tokenizedVaultDepositor: PublicKey
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
			tokenizedVaultDepositor,
			driftUser: await getUserAccountPublicKey(
				this.driftClient.program.programId,
				vault
			),
			driftState: await this.driftClient.getStatePublicKey(),
			driftSigner: this.driftClient.getStateAccount().signer,
			driftProgram: this.driftClient.program.programId,
		};

		return this.program.instruction.applyRebaseTokenizedDepositor({
			accounts: {
				...accounts,
			},
			remainingAccounts,
		});
	}

	public async applyRebase(
		vault: PublicKey,
		vaultDepositor: PublicKey
	): Promise<TransactionSignature> {
		return await this.createAndSendTxn([
			await this.getApplyRebaseIx(vault, vaultDepositor),
		]);
	}

	public async getApplyRebaseIx(
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
			driftUser: await getUserAccountPublicKey(
				this.driftClient.program.programId,
				vault
			),
			driftState: await this.driftClient.getStatePublicKey(),
			driftSigner: this.driftClient.getStateAccount().signer,
			driftProgram: this.driftClient.program.programId,
		};

		return this.program.instruction.applyRebase({
			accounts: {
				...accounts,
			},
			remainingAccounts,
		});
	}

	public async applyRebaseTokenizedDepositor(
		vault: PublicKey,
		tokenizedVaultDepositor: PublicKey
	): Promise<TransactionSignature> {
		return await this.createAndSendTxn([
			await this.getApplyRebaseTokenizedDepositorIx(
				vault,
				tokenizedVaultDepositor
			),
		]);
	}

	private createInitVaultDepositorIx(
		vault: PublicKey,
		authority?: PublicKey,
		payer?: PublicKey
	) {
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
				payer: payer || authority || this.driftClient.wallet.publicKey,
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
		authority?: PublicKey,
		payer?: PublicKey,
		uiTxParams?: TxParams
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
			return this.program.methods
				.initializeVaultDepositor()
				.accounts({
					...accounts,
					payer: payer || authority || this.driftClient.wallet.publicKey,
					rent: SYSVAR_RENT_PUBKEY,
					systemProgram: SystemProgram.programId,
				})
				.rpc();
		} else {
			const initIx = this.createInitVaultDepositorIx(vault, authority, payer);
			return await this.createAndSendTxn([initIx], uiTxParams);
		}
	}

	public async initializeTokenizedVaultDepositor(params: {
		vault: PublicKey;
		tokenName: string;
		tokenSymbol: string;
		tokenUri: string;
		decimals?: number;
		sharesBase?: number;
	}): Promise<TransactionSignature> {
		if (!this.metaplex) {
			throw new Error(
				'Metaplex instance is required when constructing VaultClient to initialize a tokenized vault depositor'
			);
		}

		let spotMarketDecimals = 6;
		let sharesBase = 0;
		if (params.decimals === undefined || params.sharesBase === undefined) {
			const vault = await this.program.account.vault.fetch(params.vault);
			const spotMarketAccount = this.driftClient.getSpotMarketAccount(
				vault.spotMarketIndex
			);
			if (!spotMarketAccount) {
				throw new Error(
					`DriftClient failed to load vault's spot market (marketIndex: ${vault.spotMarketIndex})`
				);
			}
			spotMarketDecimals = spotMarketAccount.decimals;
			sharesBase = vault.sharesBase;
		}

		const mintAddress = getTokenizedVaultMintAddressSync(
			this.program.programId,
			params.vault,
			sharesBase
		);

		const accounts = {
			vault: params.vault,
			vaultDepositor: getTokenizedVaultAddressSync(
				this.program.programId,
				params.vault,
				sharesBase
			),
			mintAccount: mintAddress,
			metadataAccount: this.metaplex.nfts().pdas().metadata({
				mint: mintAddress,
			}),
			tokenMetadataProgram: this.metaplex.programs().getTokenMetadata().address,
			payer: this.driftClient.wallet.publicKey,
		};

		const vaultTokenAta = getAssociatedTokenAddressSync(
			mintAddress,
			params.vault,
			true
		);
		const createAtaIx = createAssociatedTokenAccountInstruction(
			this.driftClient.wallet.publicKey,
			vaultTokenAta,
			params.vault,
			mintAddress
		);

		if (!this.cliMode) {
			throw new Error(
				'CLI mode is not supported for initializeTokenizedVaultDepositor'
			);
		}
		return await this.program.methods
			.initializeTokenizedVaultDepositor({
				...params,
				decimals: params.decimals ?? spotMarketDecimals,
			})
			.preInstructions([
				ComputeBudgetProgram.setComputeUnitPrice({
					microLamports: 50_000,
				}),
			])
			.postInstructions([createAtaIx])
			.accounts(accounts)
			.rpc();
	}

	public async createTokenizeSharesIx(
		vaultDepositor: PublicKey,
		amount: BN,
		unit: WithdrawUnit,
		mint?: PublicKey
	): Promise<TransactionInstruction[]> {
		const vaultDepositorAccount =
			await this.program.account.vaultDepositor.fetch(vaultDepositor);
		const vaultAccount = await this.program.account.vault.fetch(
			vaultDepositorAccount.vault
		);

		mint =
			mint ??
			getTokenizedVaultMintAddressSync(
				this.program.programId,
				vaultDepositorAccount.vault,
				vaultAccount.sharesBase
			);

		const userAta = getAssociatedTokenAddressSync(
			mint,
			this.driftClient.wallet.publicKey,
			true
		);

		const ixs = [];

		const userAtaExists = await this.driftClient.connection.getAccountInfo(
			userAta
		);
		if (userAtaExists === null) {
			ixs.push(
				createAssociatedTokenAccountInstruction(
					this.driftClient.wallet.publicKey,
					userAta,
					this.driftClient.wallet.publicKey,
					mint
				)
			);
		}

		const user = await this.getSubscribedVaultUser(vaultAccount.user);
		const remainingAccounts = this.driftClient.getRemainingAccounts({
			userAccounts: [user.getUserAccount()],
			writableSpotMarketIndexes: [vaultAccount.spotMarketIndex],
		});

		ixs.push(
			await this.program.methods
				// anchor idl bug: https://github.com/coral-xyz/anchor/issues/2914
				// @ts-ignore
				.tokenizeShares(amount, unit)
				.accounts({
					authority: this.driftClient.wallet.publicKey,
					vault: vaultDepositorAccount.vault,
					vaultDepositor,
					tokenizedVaultDepositor: getTokenizedVaultAddressSync(
						this.program.programId,
						vaultDepositorAccount.vault,
						vaultAccount.sharesBase
					),
					mint,
					userTokenAccount: userAta,
					driftUser: vaultAccount.user,
					tokenProgram: TOKEN_PROGRAM_ID,
				})
				.remainingAccounts(remainingAccounts)
				.instruction()
		);

		return ixs;
	}

	public async tokenizeShares(
		vaultDepositor: PublicKey,
		amount: BN,
		unit: WithdrawUnit,
		mint?: PublicKey,
		txParams?: TxParams
	): Promise<TransactionSignature> {
		const ixs = await this.createTokenizeSharesIx(
			vaultDepositor,
			amount,
			unit,
			mint
		);
		if (this.cliMode) {
			try {
				const tx = new Transaction().add(...ixs);
				const txSig = await this.driftClient.txSender.send(
					tx,
					undefined,
					undefined,
					false
				);
				return txSig.txSig;
			} catch (e) {
				console.error(e);
				throw e;
			}
		} else {
			return await this.createAndSendTxn(ixs, txParams);
		}
	}

	public async createRedeemTokensIx(
		vaultDepositor: PublicKey,
		tokensToBurn: BN,
		sharesBase?: number
	): Promise<TransactionInstruction> {
		const vaultDepositorAccount =
			await this.program.account.vaultDepositor.fetch(vaultDepositor);
		const vaultAccount = await this.program.account.vault.fetch(
			vaultDepositorAccount.vault
		);

		const mint = getTokenizedVaultMintAddressSync(
			this.program.programId,
			vaultDepositorAccount.vault,
			sharesBase ?? vaultAccount.sharesBase
		);

		const userAta = getAssociatedTokenAddressSync(
			mint,
			this.driftClient.wallet.publicKey,
			true
		);

		const vaultTokenAta = getAssociatedTokenAddressSync(
			mint,
			vaultDepositorAccount.vault,
			true
		);

		const user = await this.getSubscribedVaultUser(vaultAccount.user);
		const remainingAccounts = this.driftClient.getRemainingAccounts({
			userAccounts: [user.getUserAccount()],
			writableSpotMarketIndexes: [vaultAccount.spotMarketIndex],
		});

		return await this.program.methods
			.redeemTokens(tokensToBurn)
			.accounts({
				authority: this.driftClient.wallet.publicKey,
				vault: vaultDepositorAccount.vault,
				vaultDepositor,
				tokenizedVaultDepositor: getTokenizedVaultAddressSync(
					this.program.programId,
					vaultDepositorAccount.vault,
					sharesBase ?? vaultAccount.sharesBase
				),
				mint,
				userTokenAccount: userAta,
				vaultTokenAccount: vaultTokenAta,
				driftUser: vaultAccount.user,
				tokenProgram: TOKEN_PROGRAM_ID,
			})
			.remainingAccounts(remainingAccounts)
			.instruction();
	}

	/**
	 * Redeems tokens from the vault.
	 * @param vaultDepositor
	 * @param tokensToBurn
	 * @param mint optionally provide a mint, or infer the mint from the current vault share base
	 * @param txParams
	 * @returns
	 */
	public async redeemTokens(
		vaultDepositor: PublicKey,
		tokensToBurn: BN,
		sharesBase?: number,
		txParams?: TxParams
	): Promise<TransactionSignature> {
		const ix = await this.createRedeemTokensIx(
			vaultDepositor,
			tokensToBurn,
			sharesBase
		);
		if (this.cliMode) {
			try {
				const tx = new Transaction().add(ix);
				const txSig = await this.driftClient.txSender.send(
					tx,
					undefined,
					undefined,
					false
				);
				return txSig.txSig;
			} catch (e) {
				console.error(e);
				throw e;
			}
		} else {
			return await this.createAndSendTxn([ix], txParams);
		}
	}

	public async prepDepositTx(
		vaultDepositor: PublicKey,
		amount: BN,
		initVaultDepositor?: {
			authority: PublicKey;
			vault: PublicKey;
		},
		depositTokenAccount?: PublicKey
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
		if (vaultAccount.vaultProtocol) {
			const vaultProtocol = this.getVaultProtocolAddress(vaultPubKey);
			remainingAccounts.push({
				pubkey: vaultProtocol,
				isSigner: false,
				isWritable: true,
			});
		}

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

		const nonWSolUserTokenAccount =
			depositTokenAccount ??
			getAssociatedTokenAddressSync(
				spotMarket.mint,
				this.driftClient.wallet.publicKey,
				true
			);

		const { userTokenAccount, preIxs, postIxs } = await this.handleWSolMovement(
			amount,
			spotMarket,
			nonWSolUserTokenAccount
		);

		const accounts = {
			vault: vaultPubKey,
			vaultDepositor,
			vaultTokenAccount: vaultAccount.tokenAccount,
			driftUserStats: userStatsKey,
			driftUser: vaultAccount.user,
			driftState: driftStateKey,
			driftSpotMarketVault: spotMarket.vault,
			userTokenAccount: userTokenAccount,
			driftProgram: this.driftClient.program.programId,
			tokenProgram: TOKEN_PROGRAM_ID,
		};

		return {
			vaultAccount,
			accounts,
			remainingAccounts,
			preIxs,
			postIxs,
		};
	}

	/**
	 * Creates a transaction to deposit funds into the specified vault.
	 * Uses the associated token account of the vault depositor authority and spot market mint,
	 * and assumes it exists before calling this function.
	 * @param vaultDepositor
	 * @param amount
	 * @param initVaultDepositor If true, will initialize the vault depositor account
	 * @returns transaction
	 */
	public async createDepositTx(
		vaultDepositor: PublicKey,
		amount: BN,
		initVaultDepositor?: {
			authority: PublicKey;
			vault: PublicKey;
		},
		txParams?: TxParams
	): Promise<VersionedTransaction> {
		const { vaultAccount, accounts, remainingAccounts, preIxs, postIxs } =
			await this.prepDepositTx(vaultDepositor, amount, initVaultDepositor);

		const ixs: TransactionInstruction[] = [];

		if (initVaultDepositor) {
			ixs.push(
				this.createInitVaultDepositorIx(
					vaultAccount.pubkey,
					initVaultDepositor.authority
				)
			);
		}

		const depositIx = await this.program.methods
			.deposit(amount)
			.accounts({
				authority: this.driftClient.wallet.publicKey,
				...accounts,
			})
			.remainingAccounts(remainingAccounts)
			.instruction();
		ixs.push(...preIxs);
		ixs.push(depositIx);
		ixs.push(...postIxs);

		return await this.createTxn(ixs, txParams);
	}

	/**
	 * Depositor funds into the specified vault.
	 * @param vaultDepositor
	 * @param amount
	 * @param initVaultDepositor If true, will initialize the vault depositor account
	 * @param txParams
	 * @returns
	 */
	public async deposit(
		vaultDepositor: PublicKey,
		amount: BN,
		initVaultDepositor?: {
			authority: PublicKey;
			vault: PublicKey;
		},
		txParams?: TxParams,
		userTokenAccount?: PublicKey
	): Promise<TransactionSignature> {
		if (this.cliMode) {
			const { vaultAccount, accounts, remainingAccounts, preIxs, postIxs } =
				await this.prepDepositTx(
					vaultDepositor,
					amount,
					initVaultDepositor,
					userTokenAccount
				);

			if (initVaultDepositor) {
				await this.initializeVaultDepositor(
					vaultAccount.pubkey,
					initVaultDepositor.authority
				);
			}
			return this.program.methods
				.deposit(amount)
				.accounts(accounts)
				.remainingAccounts(remainingAccounts)
				.preInstructions(preIxs)
				.postInstructions(postIxs)
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
		if (vaultAccount.vaultProtocol) {
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

		const accounts = {
			vault: vaultDepositorAccount.vault,
			vaultDepositor,
			driftUser: vaultAccount.user,
			driftUserStats: userStatsKey,
		};

		if (this.cliMode) {
			return await this.program.methods
				// @ts-ignore
				.requestWithdraw(amount, withdrawUnit)
				.accounts(accounts)
				.remainingAccounts(remainingAccounts)
				.rpc();
		} else {
			const oracleFeedsToCrankIxs = await this.getOracleFeedsToCrank(
				txParams?.oracleFeedsToCrank
			);

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

			return await this.createAndSendTxn(
				[...oracleFeedsToCrankIxs, requestWithdrawIx],
				txParams
			);
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

		const isSolMarket = spotMarket.mint.equals(WRAPPED_SOL_MINT);

		// let createAtaIx: TransactionInstruction | undefined = undefined;
		let userAta = getAssociatedTokenAddressSync(
			spotMarket.mint,
			this.driftClient.wallet.publicKey,
			true
		);

		const preIxs: TransactionInstruction[] = [];
		const postIxs: TransactionInstruction[] = [];

		if (isSolMarket) {
			const { ixs, pubkey } =
				await this.driftClient.getWrappedSolAccountCreationIxs(ZERO, false);

			userAta = pubkey;
			preIxs.push(...ixs);
			postIxs.push(createSyncNativeInstruction(userAta));
			postIxs.push(
				createCloseAccountInstruction(
					userAta,
					this.driftClient.wallet.publicKey,
					this.driftClient.wallet.publicKey,
					[]
				)
			);
		} else {
			const userAtaExists = await this.driftClient.connection.getAccountInfo(
				userAta
			);
			if (userAtaExists === null) {
				preIxs.push(
					createAssociatedTokenAccountInstruction(
						this.driftClient.wallet.publicKey,
						userAta,
						this.driftClient.wallet.publicKey,
						spotMarket.mint
					)
				);
			}
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
			return await this.program.methods
				.withdraw()
				.accounts(accounts)
				.remainingAccounts(remainingAccounts)
				.preInstructions(preIxs)
				.postInstructions(postIxs)
				.rpc();
		} else {
			const oracleFeedsToCrankIxs = await this.getOracleFeedsToCrank(
				txParams?.oracleFeedsToCrank
			);

			const ixs = [
				...oracleFeedsToCrankIxs,
				...preIxs,
				await this.program.methods
					.withdraw()
					.accounts({
						authority: this.driftClient.wallet.publicKey,
						...accounts,
					})
					.remainingAccounts(remainingAccounts)
					.instruction(),
				...postIxs,
			];

			const creationIxs = preIxs.concat(postIxs).length;
			return await this.createAndSendTxn(ixs, {
				cuLimit:
					(txParams?.cuLimit ?? 650_000) + (creationIxs > 0 ? 200_000 : 0),
				...txParams,
			});
		}
	}

	public async forceWithdraw(
		vaultDepositor: PublicKey
	): Promise<TransactionSignature> {
		const ix = await this.getForceWithdrawIx(vaultDepositor);
		return await this.createAndSendTxn(ix);
	}

	public async getForceWithdrawIx(
		vaultDepositor: PublicKey
	): Promise<TransactionInstruction[]> {
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
		if (vaultAccount.vaultProtocol) {
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

		const spotMarket = this.driftClient.getSpotMarketAccount(
			vaultAccount.spotMarketIndex
		);
		if (!spotMarket) {
			throw new Error(
				`Spot market ${vaultAccount.spotMarketIndex} not found on driftClient`
			);
		}

		const [userTokenAccount, createAtaIx] = await getOrCreateATAInstruction(
			spotMarket.mint,
			vaultDepositorAccount.authority,
			this.driftClient.connection,
			true,
			this.driftClient.wallet.publicKey
		);

		if (createAtaIx) {
			console.log(
				`Creating ATA for ${vaultDepositorAccount.authority.toBase58()} to ${userTokenAccount.toBase58()}`
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
			userTokenAccount,
			driftProgram: this.driftClient.program.programId,
			tokenProgram: TOKEN_PROGRAM_ID,
		};

		const ixs = [];

		if (createAtaIx) {
			ixs.push(createAtaIx);
		}

		ixs.push(
			await this.program.methods
				.forceWithdraw()
				.accounts(accounts)
				.remainingAccounts(remainingAccounts)
				.instruction()
		);

		return ixs;
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

		const accounts = {
			vault: vaultDepositorAccount.vault,
			vaultDepositor,
			driftUserStats: userStatsKey,
			driftUser: vaultAccount.user,
		};

		const user = await this.getSubscribedVaultUser(vaultAccount.user);
		const remainingAccounts = this.driftClient.getRemainingAccounts({
			userAccounts: [user.getUserAccount()],
		});
		if (vaultAccount.vaultProtocol) {
			const vaultProtocol = this.getVaultProtocolAddress(
				vaultDepositorAccount.vault
			);
			remainingAccounts.push({
				pubkey: vaultProtocol,
				isSigner: false,
				isWritable: true,
			});
		}

		if (this.cliMode) {
			return await this.program.methods
				.cancelRequestWithdraw()
				.accounts(accounts)
				.remainingAccounts(remainingAccounts)
				.rpc();
		} else {
			const oracleFeedsToCrankIxs = await this.getOracleFeedsToCrank(
				txParams?.oracleFeedsToCrank
			);

			const cancelRequestWithdrawIx =
				this.program.instruction.cancelRequestWithdraw({
					accounts: {
						authority: this.driftClient.wallet.publicKey,
						...accounts,
					},
					remainingAccounts,
				});

			return await this.createAndSendTxn(
				[...oracleFeedsToCrankIxs, cancelRequestWithdrawIx],
				txParams
			);
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

		const ifVaultTokenAccount = getInsuranceFundTokenVaultAddressSync(
			this.program.programId,
			vault,
			spotMarketIndex
		);

		return await this.program.methods
			.initializeInsuranceFundStake(spotMarketIndex)
			.accounts({
				vault: vault,
				driftSpotMarket: spotMarket.pubkey,
				driftSpotMarketMint: spotMarket.mint,
				vaultTokenAccount: ifVaultTokenAccount,
				insuranceFundStake: ifStakeAccountPublicKey,
				driftUserStats: vaultAccount.userStats,
				driftState: await this.driftClient.getStatePublicKey(),
				driftProgram: this.driftClient.program.programId,
			})
			.rpc();
	}

	/**
	 * Adds an amount to an insurance fund stake for the vault.
	 * @param vault vault address to update
	 * @param spotMarketIndex spot market index of the insurance fund stake
	 * @param amount amount to add to the insurance fund stake, in spotMarketIndex precision
	 * @returns
	 */
	public async addToInsuranceFundStake(
		vault: PublicKey,
		spotMarketIndex: number,
		amount: BN,
		managerTokenAccount?: PublicKey
	): Promise<TransactionSignature> {
		const vaultAccount = await this.program.account.vault.fetch(vault);

		if (!vaultAccount.manager.equals(this.driftClient.wallet.publicKey)) {
			throw new Error(
				`Only the manager of the vault can add to the insurance fund stake.`
			);
		}

		const ifStakeAccountPublicKey = getInsuranceFundStakeAccountPublicKey(
			this.driftClient.program.programId,
			vault,
			spotMarketIndex
		);
		const ifVaultPublicKey = await getInsuranceFundVaultPublicKey(
			this.driftClient.program.programId,
			spotMarketIndex
		);

		const spotMarket = this.driftClient.getSpotMarketAccount(spotMarketIndex);
		if (!spotMarket) {
			throw new Error(
				`Spot market ${spotMarketIndex} not found on driftClient`
			);
		}

		if (!managerTokenAccount) {
			managerTokenAccount = getAssociatedTokenAddressSync(
				spotMarket.mint,
				this.driftClient.wallet.publicKey
			);
		}

		const ifVaultTokenAccount = getInsuranceFundTokenVaultAddressSync(
			this.program.programId,
			vault,
			spotMarketIndex
		);

		return await this.program.methods
			.addInsuranceFundStake(spotMarketIndex, amount)
			.accounts({
				vault: vault,
				driftSpotMarket: spotMarket.pubkey,
				driftSpotMarketVault: spotMarket.vault,
				insuranceFundStake: ifStakeAccountPublicKey,
				insuranceFundVault: ifVaultPublicKey,
				managerTokenAccount,
				vaultIfTokenAccount: ifVaultTokenAccount,
				driftUserStats: vaultAccount.userStats,
				driftState: await this.driftClient.getStatePublicKey(),
				driftProgram: this.driftClient.program.programId,
				driftSigner: this.driftClient.getStateAccount().signer,
				tokenProgram: TOKEN_PROGRAM_ID,
			})
			.rpc();
	}

	public async requestRemoveInsuranceFundStake(
		vault: PublicKey,
		spotMarketIndex: number,
		amount: BN
	): Promise<TransactionSignature> {
		const vaultAccount = await this.program.account.vault.fetch(vault);
		const ifStakeAccountPublicKey = getInsuranceFundStakeAccountPublicKey(
			this.driftClient.program.programId,
			vault,
			spotMarketIndex
		);
		const ifVaultPublicKey = await getInsuranceFundVaultPublicKey(
			this.driftClient.program.programId,
			spotMarketIndex
		);

		const spotMarket = this.driftClient.getSpotMarketAccount(spotMarketIndex);
		if (!spotMarket) {
			throw new Error(
				`Spot market ${spotMarketIndex} not found on driftClient`
			);
		}

		return await this.program.methods
			.requestRemoveInsuranceFundStake(spotMarketIndex, amount)
			.accounts({
				vault,
				manager: this.driftClient.wallet.publicKey,
				driftSpotMarket: spotMarket.pubkey,
				insuranceFundStake: ifStakeAccountPublicKey,
				insuranceFundVault: ifVaultPublicKey,
				driftUserStats: vaultAccount.userStats,
				driftProgram: this.driftClient.program.programId,
			})
			.rpc();
	}

	public async cancelRequestRemoveInsuranceFundStake(
		vault: PublicKey,
		spotMarketIndex: number
	): Promise<TransactionSignature> {
		const vaultAccount = await this.program.account.vault.fetch(vault);
		const ifStakeAccountPublicKey = getInsuranceFundStakeAccountPublicKey(
			this.driftClient.program.programId,
			vault,
			spotMarketIndex
		);
		const ifVaultPublicKey = await getInsuranceFundVaultPublicKey(
			this.driftClient.program.programId,
			spotMarketIndex
		);
		const spotMarket = this.driftClient.getSpotMarketAccount(spotMarketIndex);
		if (!spotMarket) {
			throw new Error(
				`Spot market ${spotMarketIndex} not found on driftClient`
			);
		}

		return await this.program.methods
			.cancelRequestRemoveInsuranceFundStake(spotMarketIndex)
			.accounts({
				vault: vault,
				manager: this.driftClient.wallet.publicKey,
				driftSpotMarket: spotMarket.pubkey,
				insuranceFundStake: ifStakeAccountPublicKey,
				insuranceFundVault: ifVaultPublicKey,
				driftUserStats: vaultAccount.userStats,
				driftProgram: this.driftClient.program.programId,
			})
			.rpc();
	}

	public async removeInsuranceFundStake(
		vault: PublicKey,
		spotMarketIndex: number,
		managerTokenAccount?: PublicKey
	): Promise<TransactionSignature> {
		const vaultAccount = await this.program.account.vault.fetch(vault);
		const ifStakeAccountPublicKey = getInsuranceFundStakeAccountPublicKey(
			this.driftClient.program.programId,
			vault,
			spotMarketIndex
		);
		const ifVaultPublicKey = await getInsuranceFundVaultPublicKey(
			this.driftClient.program.programId,
			spotMarketIndex
		);
		const spotMarket = this.driftClient.getSpotMarketAccount(spotMarketIndex);
		if (!spotMarket) {
			throw new Error(
				`Spot market ${spotMarketIndex} not found on driftClient`
			);
		}

		if (!managerTokenAccount) {
			managerTokenAccount = getAssociatedTokenAddressSync(
				spotMarket.mint,
				this.driftClient.wallet.publicKey
			);
		}

		const ifVaultTokenAccount = getInsuranceFundTokenVaultAddressSync(
			this.program.programId,
			vault,
			spotMarketIndex
		);

		return await this.program.methods
			.removeInsuranceFundStake(spotMarketIndex)
			.accounts({
				vault: vault,
				driftSpotMarket: spotMarket.pubkey,
				insuranceFundStake: ifStakeAccountPublicKey,
				insuranceFundVault: ifVaultPublicKey,
				managerTokenAccount,
				vaultIfTokenAccount: ifVaultTokenAccount,
				driftState: await this.driftClient.getStatePublicKey(),
				driftUserStats: vaultAccount.userStats,
				driftSigner: this.driftClient.getStateAccount().signer,
				driftProgram: this.driftClient.program.programId,
				tokenProgram: TOKEN_PROGRAM_ID,
			})
			.rpc();
	}

	public async protocolRequestWithdraw(
		vault: PublicKey,
		amount: BN,
		withdrawUnit: WithdrawUnit
	): Promise<TransactionSignature> {
		// @ts-ignore
		const vaultAccount = (await this.program.account.vault.fetch(
			vault
		)) as Vault;
		const vp = this.getVaultProtocolAddress(vault);
		const vpAccount = (await this.program.account.vaultProtocol.fetch(
			vp
		)) as VaultProtocol;

		if (!this.driftClient.wallet.publicKey.equals(vpAccount.protocol)) {
			throw new Error(`Only the protocol of the vault can request a withdraw.`);
		}

		const user = await this.getSubscribedVaultUser(vaultAccount.user);
		const remainingAccounts = this.driftClient.getRemainingAccounts({
			userAccounts: [user.getUserAccount()],
			writableSpotMarketIndexes: [vaultAccount.spotMarketIndex],
		});
		if (vaultAccount.vaultProtocol) {
			const vaultProtocol = this.getVaultProtocolAddress(vault);
			remainingAccounts.push({
				pubkey: vaultProtocol,
				isSigner: false,
				isWritable: true,
			});
		}

		const userStatsKey = getUserStatsAccountPublicKey(
			this.driftClient.program.programId,
			vault
		);

		const accounts = {
			vault,
			driftUserStats: userStatsKey,
			driftUser: vaultAccount.user,
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

	public async protocolCancelWithdrawRequest(
		vault: PublicKey
	): Promise<TransactionSignature> {
		const vaultAccount = await this.program.account.vault.fetch(vault);

		const userStatsKey = getUserStatsAccountPublicKey(
			this.driftClient.program.programId,
			vault
		);

		const accounts = {
			manager: this.driftClient.wallet.publicKey,
			vault,
			driftUserStats: userStatsKey,
			driftUser: vaultAccount.user,
		};

		const user = await this.getSubscribedVaultUser(vaultAccount.user);
		const remainingAccounts = this.driftClient.getRemainingAccounts({
			userAccounts: [user.getUserAccount()],
		});
		if (vaultAccount.vaultProtocol) {
			const vaultProtocol = this.getVaultProtocolAddress(vault);
			remainingAccounts.push({
				pubkey: vaultProtocol,
				isSigner: false,
				isWritable: true,
			});
		}

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

	public async protocolWithdraw(
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
		if (vaultAccount.vaultProtocol) {
			const vaultProtocol = this.getVaultProtocolAddress(vault);
			remainingAccounts.push({
				pubkey: vaultProtocol,
				isSigner: false,
				isWritable: true,
			});
		}

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

	private async getOracleFeedsToCrank(
		oracleFeedsToCrank: TxParams['oracleFeedsToCrank']
	) {
		const oracleFeedsToCrankIxs: TransactionInstruction[] = oracleFeedsToCrank
			? ((await Promise.all(
					oracleFeedsToCrank.map(async (feedConfig) => {
						if (
							JSON.stringify(feedConfig.oracleSource) !==
							JSON.stringify(OracleSource.SWITCHBOARD_ON_DEMAND)
						) {
							throw new Error(
								'Only SWITCHBOARD_ON_DEMAND oracle feeds are supported for cranking'
							);
						}

						return this.driftClient.getPostSwitchboardOnDemandUpdateAtomicIx(
							feedConfig.feed
						);
					})
			  )) as TransactionInstruction[])
			: [];

		return oracleFeedsToCrankIxs;
	}
}
