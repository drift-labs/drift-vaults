import {
	BN,
	DriftClient,
	getUserAccountPublicKey,
	getUserAccountPublicKeySync,
	getUserStatsAccountPublicKey,
	User,
} from '@drift-labs/sdk';
import { Program } from '@coral-xyz/anchor';
import { DriftVaults } from './types/drift_vaults';
import {
	getTokenVaultAddressSync,
	getVaultAddressSync,
	getVaultDepositorAddressSync,
} from './addresses';
import { PublicKey, TransactionSignature } from '@solana/web3.js';
import {
	getAssociatedTokenAddressSync,
	TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import { WithdrawUnit } from './types/types';

export class VaultClient {
	driftClient: DriftClient;
	program: Program<DriftVaults>;

	constructor({
		driftClient,
		program,
	}: {
		driftClient: DriftClient;
		program: Program<DriftVaults>;
	}) {
		this.driftClient = driftClient;
		this.program = program;
	}

	public async getVault(vault: PublicKey): Promise<any> {
		return await this.program.account.vault.fetch(vault);
	}

	public async getVaultDepositor(vaultDepositor: PublicKey): Promise<any> {
		return await this.program.account.vaultDepositor.fetch(vaultDepositor);
	}

	public async initializeVault(params: {
		name: number[];
		spotMarketIndex: number;
		redeemPeriod: BN;
		maxTokens: BN;
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

		const userStatsKey = getUserStatsAccountPublicKey(
			this.driftClient.program.programId,
			vault
		);
		const userKey = getUserAccountPublicKeySync(
			this.driftClient.program.programId,
			vault
		);

		return await this.program.methods
			.initializeVault(params)
			.accounts({
				driftSpotMarket: spotMarket.pubkey,
				driftSpotMarketMint: spotMarket.mint,
				driftUserStats: userStatsKey,
				driftUser: userKey,
				driftState,
				vault,
				tokenAccount,
				driftProgram: this.driftClient.program.programId,
			})
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

	public async managerWithdraw(
		vault: PublicKey,
		amount: BN,
		withdrawUnit: WithdrawUnit
	): Promise<TransactionSignature> {
		const vaultAccount = await this.program.account.vault.fetch(vault);

		const user = new User({
			driftClient: this.driftClient,
			userAccountPublicKey: vaultAccount.user,
		});
		await user.subscribe();

		const remainingAccounts = this.driftClient.getRemainingAccounts({
			userAccounts: [user.getUserAccount()],
		});

		const spotMarket = this.driftClient.getSpotMarketAccount(
			vaultAccount.spotMarketIndex
		);
		if (!spotMarket) {
			throw new Error(
				`Spot market ${vaultAccount.spotMarketIndex} not found on driftClient`
			);
		}

		return await this.program.methods
			.managerWithdraw(amount, withdrawUnit)
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
				driftSpotMarketVault: spotMarket.vault,
				userTokenAccount: getAssociatedTokenAddressSync(
					spotMarket.mint,
					this.driftClient.wallet.publicKey
				),
				driftSigner: this.driftClient.getStateAccount().signer,
			})
			.remainingAccounts(remainingAccounts)
			.rpc();
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
			authority
		);

		return await this.program.methods
			.initializeVaultDepositor()
			.accounts({
				vaultDepositor,
				vault,
				authority: authority || this.driftClient.wallet.publicKey,
			})
			.rpc();
	}

	public async deposit(
		vaultDepositor: PublicKey,
		amount: BN
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

		return await this.program.methods
			.deposit(amount)
			.accounts({
				vault: vaultDepositorAccount.vault,
				vaultDepositor,
				vaultTokenAccount: vaultAccount.tokenAccount,
				driftUserStats: userStatsKey,
				driftUser: vaultAccount.user,
				driftState: driftStateKey,
				driftSpotMarketVault: spotMarket.vault,
				userTokenAccount: getAssociatedTokenAddressSync(
					spotMarket.mint,
					this.driftClient.wallet.publicKey
				),
				driftProgram: this.driftClient.program.programId,
				tokenProgram: TOKEN_PROGRAM_ID,
			})
			.remainingAccounts(remainingAccounts)
			.rpc();
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

		return await this.program.methods
			.requestWithdraw(amount, withdrawUnit)
			.accounts({
				vault: vaultDepositorAccount.vault,
				vaultDepositor,
				driftUserStats: userStatsKey,
				driftUser: vaultAccount.user,
				driftState: driftStateKey,
			})
			.remainingAccounts(remainingAccounts)
			.rpc();
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

		return await this.program.methods
			.withdraw()
			.accounts({
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
					this.driftClient.wallet.publicKey
				),
				driftProgram: this.driftClient.program.programId,
				tokenProgram: TOKEN_PROGRAM_ID,
			})
			.remainingAccounts(remainingAccounts)
			.rpc();
	}
}
