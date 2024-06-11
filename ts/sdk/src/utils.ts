import { AnchorProvider } from '@coral-xyz/anchor';
import { DriftClient, IWallet } from '@drift-labs/sdk';
import { Connection } from '@solana/web3.js';
import { DriftVaults, IDL } from './types/drift_vaults';
import { VaultClient } from './vaultClient';
import * as anchor from '@coral-xyz/anchor';
import { VAULT_PROGRAM_ID } from './types/types';

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
