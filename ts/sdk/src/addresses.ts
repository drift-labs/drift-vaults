import { PublicKey } from '@solana/web3.js';
import * as anchor from '@coral-xyz/anchor';

export function getVaultAddressSync(
	programId: PublicKey,
	encodedName: number[]
): PublicKey {
	return PublicKey.findProgramAddressSync(
		[
			Buffer.from(anchor.utils.bytes.utf8.encode('vault')),
			Buffer.from(encodedName),
		],
		programId
	)[0];
}

export function getVaultDepositorAddressSync(
	programId: PublicKey,
	vault: PublicKey,
	authority: PublicKey
): PublicKey {
	return PublicKey.findProgramAddressSync(
		[
			Buffer.from(anchor.utils.bytes.utf8.encode('vault_depositor')),
			vault.toBuffer(),
			authority.toBuffer(),
		],
		programId
	)[0];
}

export function getTokenVaultAddressSync(
	programId: PublicKey,
	vault: PublicKey
): PublicKey {
	return PublicKey.findProgramAddressSync(
		[
			Buffer.from(anchor.utils.bytes.utf8.encode('vault_token_account')),
			vault.toBuffer(),
		],
		programId
	)[0];
}
