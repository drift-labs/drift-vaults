import { PublicKey, TransactionInstruction } from "@solana/web3.js";
import {
    OptionValues,
    Command
} from "commander";
import { getCommandContext } from "../utils";

export const applyProfitShare = async (program: Command, cmdOpts: OptionValues) => {

    let vaultAddress: PublicKey;
    try {
        vaultAddress = new PublicKey(cmdOpts.vaultAddress as string);
    } catch (err) {
        console.error("Invalid vault address");
        process.exit(1);
    }

    const {
        driftVault
    } = await getCommandContext(program, true);

    const allVaultDepositors = await driftVault.getAllVaultDepositors(vaultAddress);
    // console.log(allVaultDepositors);

    console.log(`Cranking profit share for ${allVaultDepositors.length} depositors...`);

    const chunkSize = 10;
    const ixChunks: Array<Array<TransactionInstruction>> = [];
    for (let i = 0; i < allVaultDepositors.length; i += chunkSize) {
        const chunk = allVaultDepositors.slice(i, i + chunkSize);
        const ixs = await Promise.all(chunk.map((vaultDepositor) => {
            return driftVault.getApplyProfitShareIx(vaultAddress, vaultDepositor.publicKey);
        }));

        ixChunks.push(ixs);
    }
    console.log(`Cranking ${ixChunks.length} of ${chunkSize} depositors at a time...`);

    const txs = await Promise.all(ixChunks.map((ixs) => driftVault.createAndSendTxn(...ixs)));
    for (const tx of txs) {
        console.log(`Crank tx: https://solscan.io/tx/${tx}`);
    }


    // const ix = await driftVault.getApplyProfitShareIx(vaultAddress, );
    // console.log(`Withrew ${cmdOpts.shares} shares as vault manager: ${tx}`);
    console.log("Done!");
};