import {
	BN,
	DriftClient,
	encodeName,
	getInsuranceFundStakeAccountPublicKey,
	getUserAccountPublicKey,
	getUserAccountPublicKeySync,
	getUserStatsAccountPublicKey,
	User,
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
} from './addresses';
import {
	ComputeBudgetProgram,
	PublicKey,
	SetComputeUnitLimitParams,
	SystemProgram,
	SYSVAR_RENT_PUBKEY,
	Transaction,
	TransactionInstruction,
	TransactionSignature,
} from '@solana/web3.js';
import {
	getAssociatedTokenAddressSync,
	TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import { Vault, VaultDepositor, WithdrawUnit } from './types/types';
import { bs58 } from '@coral-xyz/anchor/dist/cjs/utils/bytes';

export class VaultClient {
	driftClient: DriftClient;
	program: Program<DriftVaults>;
	cliMode: boolean;

	constructor({
		driftClient,
		program,
		cliMode,
	}: {
		driftClient: DriftClient;
		program: Program<DriftVaults>;
		cliMode?: boolean;
	}) {
		this.driftClient = driftClient;
		this.program = program;
		this.cliMode = !!cliMode;
	}

	public async getVault(vault: PublicKey): Promise<Vault> {
		// @ts-ignore
		return await this.program.account.vault.fetch(vault);
	}

	public async getVaultDepositor(vaultDepositor: PublicKey): Promise<any> {
		return await this.program.account.vaultDepositor.fetch(vaultDepositor);
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
			{
				// last_withdraw_request_ts = 0
				memcmp: {
					offset: 144,
					bytes: bs58.encode(Uint8Array.from([0])),
				},
			},
		];
		// @ts-ignore
		return (await this.program.account.vaultDepositor.all(
			filters
		)) as ProgramAccount<VaultDepositor>[];
	}

	/**
	 *
	 * @param vault pubkey
	 * @returns vault equity, in QUOTE_PRECISION
	 */
	public async calculateVaultEquity(params: {
		address?: PublicKey;
		vault?: Vault;
	}): Promise<BN> {
		let vaultAccount: Vault;
		if (params.address !== undefined) {
			// @ts-ignore
			vaultAccount = await this.program.account.vault.fetch(params.address);
		} else if (params.vault !== undefined) {
			vaultAccount = params.vault;
		} else {
			throw new Error('Must supply address or vault');
		}

		const user = new User({
			driftClient: this.driftClient,
			userAccountPublicKey: vaultAccount.user,
		});
		await user.subscribe();

		const netSpotValue = user.getNetSpotMarketValue();
		const unrealizedPnl = user.getUnrealizedPNL(true, undefined, undefined);

		return netSpotValue.add(unrealizedPnl);
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
	}): Promise<TransactionSignature> {
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

		return await this.program.methods
			.initializeVault(params)
			.accounts(accounts)
			.rpc();
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
	 * @param enabeld whether to enable margin trading
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

		const user = new User({
			driftClient: this.driftClient,
			userAccountPublicKey: vaultAccount.user,
		});
		await user.subscribe();

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
		// @ts-ignore
		const vaultAccount = (await this.program.account.vault.fetch(
			vault
		)) as Vault;

		if (!this.driftClient.wallet.publicKey.equals(vaultAccount.manager)) {
			throw new Error(`Only the manager of the vault can request a withdraw.`);
		}

		const user = new User({
			driftClient: this.driftClient,
			userAccountPublicKey: vaultAccount.user,
		});
		await user.subscribe();
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
				.managerRequestWithdraw(amount, withdrawUnit)
				.accounts(accounts)
				.remainingAccounts(remainingAccounts)
				.rpc();
		} else {
			const requestWithdrawIx = this.program.instruction.managerRequestWithdraw(
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

		const user = new User({
			driftClient: this.driftClient,
			userAccountPublicKey: vaultAccount.user,
		});
		await user.subscribe();
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

		const user = new User({
			driftClient: this.driftClient,
			userAccountPublicKey: vaultAccount.user,
		});
		await user.subscribe();

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
			units: 1_000_000,
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
		}
	): Promise<TransactionSignature> {
		return await this.program.methods
			.updateVault(params)
			.accounts({
				vault,
				manager: this.driftClient.wallet.publicKey,
			})
			.rpc();
	}

	public async getApplyProfitShareIx(
		vault: PublicKey,
		vaultDepositor: PublicKey
	): Promise<TransactionInstruction> {
		const vaultAccount = await this.program.account.vault.fetch(vault);

		const user = new User({
			driftClient: this.driftClient,
			userAccountPublicKey: vaultAccount.user,
		});
		await user.subscribe();

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
		}
	): Promise<TransactionSignature> {
		let vaultPubKey: PublicKey;
		if (initVaultDepositor) {
			vaultPubKey = initVaultDepositor.vault;
		} else {
			const vaultDepositorAccount =
				await this.program.account.vaultDepositor.fetch(vaultDepositor);
			vaultPubKey = vaultDepositorAccount.vault;
		}

		const vaultAccount = await this.program.account.vault.fetch(vaultPubKey);

		const user = new User({
			driftClient: this.driftClient,
			userAccountPublicKey: vaultAccount.user,
		});
		await user.subscribe();
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

		if (this.cliMode) {
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
				return await this.createAndSendTxn([initIx, depositIx]);
			} else {
				return await this.createAndSendTxn([depositIx]);
			}
		}
	}

	public async requestWithdraw(
		vaultDepositor: PublicKey,
		amount: BN,
		withdrawUnit: WithdrawUnit
	): Promise<TransactionSignature> {
		const vaultDepositorAccount =
			await this.program.account.vaultDepositor.fetch(vaultDepositor);
		const vaultAccount = await this.program.account.vault.fetch(
			vaultDepositorAccount.vault
		);

		const user = new User({
			driftClient: this.driftClient,
			userAccountPublicKey: vaultAccount.user,
		});
		await user.subscribe();
		const remainingAccounts = this.driftClient.getRemainingAccounts({
			userAccounts: [user.getUserAccount()],
		});

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
				.requestWithdraw(amount, withdrawUnit)
				.accounts(accounts)
				.remainingAccounts(remainingAccounts)
				.rpc();
		} else {
			const requestWithdrawIx = this.program.instruction.requestWithdraw(
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

			return await this.createAndSendTxn([requestWithdrawIx]);
		}
	}

	public async withdraw(
		vaultDepositor: PublicKey
	): Promise<TransactionSignature> {
		const vaultDepositorAccount =
			await this.program.account.vaultDepositor.fetch(vaultDepositor);
		const vaultAccount = await this.program.account.vault.fetch(
			vaultDepositorAccount.vault
		);

		const user = new User({
			driftClient: this.driftClient,
			userAccountPublicKey: vaultAccount.user,
		});
		await user.subscribe();
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
				this.driftClient.wallet.publicKey,
				true
			),
			driftProgram: this.driftClient.program.programId,
			tokenProgram: TOKEN_PROGRAM_ID,
		};

		if (this.cliMode) {
			return await this.program.methods
				.withdraw()
				.accounts(accounts)
				.remainingAccounts(remainingAccounts)
				.rpc();
		} else {
			const withdrawIx = this.program.instruction.withdraw({
				accounts: {
					authority: this.driftClient.wallet.publicKey,
					...accounts,
				},
				remainingAccounts,
			});

			return await this.createAndSendTxn([withdrawIx]);
		}
	}

	public async cancelRequestWithdraw(
		vaultDepositor: PublicKey
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

		const user = new User({
			driftClient: this.driftClient,
			userAccountPublicKey: vaultAccount.user,
		});
		await user.subscribe();
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

			return await this.createAndSendTxn([cancelRequestWithdrawIx]);
		}
	}

	/**
	 * Liquidates (become delegate for) a vault.
	 * @param
	 * @param
	 * @returns
	 */
	public async liquidate(
		vaultDepositor: PublicKey
	): Promise<TransactionSignature> {
		const vaultDepositorAccount =
			await this.program.account.vaultDepositor.fetch(vaultDepositor);
		const vaultPubKey = vaultDepositorAccount.vault;

		const vaultAccount = await this.program.account.vault.fetch(vaultPubKey);

		const user = new User({
			driftClient: this.driftClient,
			userAccountPublicKey: vaultAccount.user,
		});
		await user.subscribe();
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

			return await this.createAndSendTxn([liquidateIx]);
		}
	}

	/**
	 * Used for UI wallet adapters compatibility
	 */
	public async createAndSendTxn(
		ixs: TransactionInstruction[],
		computeUnitParams?: SetComputeUnitLimitParams
	): Promise<TransactionSignature> {
		const tx = new Transaction();
		tx.add(
			ComputeBudgetProgram.setComputeUnitLimit(
				computeUnitParams || {
					units: 400_000,
				}
			)
		);
		tx.add(...ixs);
		const { txSig } = await this.driftClient.sendTransaction(
			tx,
			[],
			this.driftClient.opts
		);

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
