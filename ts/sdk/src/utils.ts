import { AnchorProvider } from '@coral-xyz/anchor';
import { DriftClient, IWallet } from '@drift-labs/sdk';
import { Connection, PublicKey, TransactionInstruction } from '@solana/web3.js';
import { DriftVaults, IDL } from './types/drift_vaults';
import { VaultClient } from './vaultClient';
import * as anchor from '@coral-xyz/anchor';
import { VAULT_PROGRAM_ID } from './types/types';
import {
	createAssociatedTokenAccountInstruction,
	getAssociatedTokenAddress,
} from '@solana/spl-token';

export const getDriftVaultProgram = (
	connection: Connection,
	wallet: IWallet
): anchor.Program<DriftVaults> => {
	const provider = new AnchorProvider(connection, wallet as anchor.Wallet, {});
	anchor.setProvider(provider);
	const vaultProgram = new anchor.Program(IDL, VAULT_PROGRAM_ID, provider);

	return vaultProgram;
};

export const getVaultClient = (
	connection: Connection,
	wallet: IWallet,
	driftClient: DriftClient
): VaultClient => {
	const vaultProgram = getDriftVaultProgram(connection, wallet);

	const vaultClient = new VaultClient({
		driftClient,
		program: vaultProgram,
	});

	return vaultClient;
};

export const getOrCreateATAInstruction = async (
	tokenMint: PublicKey,
	owner: PublicKey,
	connection: Connection,
	allowOwnerOffCurve = true,
	payer = owner
): Promise<[PublicKey, TransactionInstruction?]> => {
	let toAccount;
	try {
		toAccount = await getAssociatedTokenAddress(
			tokenMint,
			owner,
			allowOwnerOffCurve
		);
		const account = await connection.getAccountInfo(toAccount);
		if (!account) {
			const ix = createAssociatedTokenAccountInstruction(
				payer,
				toAccount,
				owner,
				tokenMint
			);
			return [toAccount, ix];
		}
		return [toAccount, undefined];
	} catch (e) {
		/* handle error */
		console.error('Error::getOrCreateATAInstruction', e);
		throw e;
	}
};
