import { ComputeBudgetProgram, PublicKey, Transaction, TransactionInstruction } from "@solana/web3.js";
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

    const vdToRealizeProfit = await driftVault.getAllVaultDepositorsWithNoWithdrawRequest(vaultAddress);
    console.log(`Applying profit share for ${vdToRealizeProfit.length} depositors...`);

    const chunkSize = 6;
    const ixChunks: Array<Array<TransactionInstruction>> = [];
    for (let i = 0; i < vdToRealizeProfit.length; i += chunkSize) {
        const chunk = vdToRealizeProfit.slice(i, i + chunkSize);
        const ixs = await Promise.all(chunk.map((vaultDepositor) => {
            return driftVault.getApplyProfitShareIx(vaultAddress, vaultDepositor.publicKey);
        }));

        ixChunks.push(ixs);
    }
    console.log(`Sending ${ixChunks.length} transactions...`);

    for (let i = 0; i < ixChunks.length; i++) {
        const ixs = ixChunks[i];
        try {
            ixs.unshift(ComputeBudgetProgram.setComputeUnitLimit({
                units: 1_400_000,
            }));
            ixs.unshift(ComputeBudgetProgram.setComputeUnitPrice({
                microLamports: 100,
            }));

            const tx = new Transaction();
            tx.add(...ixs);
            const { txSig } = await driftVault.driftClient.sendTransaction(
                tx,
                [],
                driftVault.driftClient.opts
            );

            console.log(`[${i}]: https://solscan.io/tx/${txSig}`);

        } catch (e) {
            console.error(e);
            continue;
        }

    }
};