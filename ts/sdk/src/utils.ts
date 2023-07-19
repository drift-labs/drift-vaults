import { AnchorProvider } from '@coral-xyz/anchor';
import { DriftClient, Wallet } from '@drift-labs/sdk';
import { Connection } from '@solana/web3.js';
import { IDL } from './types/drift_vaults';
import { VaultClient } from './vaultClient';
import * as anchor from '@coral-xyz/anchor';
import { VAULT_PROGRAM_ID } from './types/types';

export const getVaultClient = (
	connection: Connection,
	wallet: Wallet,
	driftClient: DriftClient
) => {
	const provider = new AnchorProvider(connection, wallet, {});
	anchor.setProvider(provider);
	const vaultProgram = new anchor.Program(IDL, VAULT_PROGRAM_ID, provider);

	const vaultClient = new VaultClient({
		driftClient,
		program: vaultProgram,
	});

	return vaultClient;
};
