import {PublicKey} from "@solana/web3.js";
import * as anchor from "@coral-xyz/anchor";

export function getVaultAddressSync(programId: PublicKey, encodedName: number[]) {
	return PublicKey.findProgramAddressSync(
		[Buffer.from(anchor.utils.bytes.utf8.encode('vault')), Buffer.from(encodedName)],
		programId
	)[0];
}