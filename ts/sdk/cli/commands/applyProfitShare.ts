import { ComputeBudgetProgram, PublicKey, Transaction, TransactionInstruction } from "@solana/web3.js";
import {
    OptionValues,
    Command
} from "commander";
import { getCommandContext } from "../utils";
import { VaultDepositor, calculateApplyProfitShare } from "../../src";
import { BN, TEN, ZERO, numberToSafeBN } from "@drift-labs/sdk";
import { ProgramAccount } from "@coral-xyz/anchor";

export const applyProfitShare = async (program: Command, cmdOpts: OptionValues) => {

    let vaultAddress: PublicKey;
    try {
        vaultAddress = new PublicKey(cmdOpts.vaultAddress as string);
    } catch (err) {
        console.error("Invalid vault address");
        process.exit(1);
    }

    const {
        driftVault,
        driftClient,
    } = await getCommandContext(program, true);

    const vault = await driftVault.getVault(vaultAddress);
    const vdWithNoWithdrawRequests = await driftVault.getAllVaultDepositorsWithNoWithdrawRequest(vaultAddress);
    const vaultEquity = await driftVault.calculateVaultEquity({ vault });

    const spotMarket = driftClient.getSpotMarketAccount(vault.spotMarketIndex);
    if (!spotMarket) {
        throw new Error(`Spot market account ${vault.spotMarketIndex} has not been loaded`);
    }
    const spotMarketPrecision = TEN.pow(new BN(spotMarket.decimals));
    const thresholdNumber = parseFloat(cmdOpts.threshold);
    const thresholdBN = numberToSafeBN(thresholdNumber, spotMarketPrecision);
    let pendingProfitShareToRealize = ZERO;
    const vdWithPendingProfitShare = vdWithNoWithdrawRequests.filter((vd: ProgramAccount<VaultDepositor>) => {
        const pendingProfitShares = calculateApplyProfitShare(vd.account, vaultEquity, vault);
        const doRealize = pendingProfitShares.profitShareAmount.gt(thresholdBN);
        if (doRealize) {
            pendingProfitShareToRealize = pendingProfitShareToRealize.add(pendingProfitShares.profitShareAmount);
            return true;
        } else {
            return false;
        }
    });

    console.log(`${vdWithPendingProfitShare.length}/${vdWithNoWithdrawRequests.length} depositors have pending profit shares above threshold ${cmdOpts.threshold} (${thresholdBN.toString()})`);
    console.log(`Applying profit share for ${vdWithPendingProfitShare.length} depositors.`);

    const chunkSize = 5;
    const ixChunks: Array<Array<TransactionInstruction>> = [];
    for (let i = 0; i < vdWithPendingProfitShare.length; i += chunkSize) {
        const chunk = vdWithPendingProfitShare.slice(i, i + chunkSize);
        const ixs = await Promise.all(chunk.map((vd: ProgramAccount<VaultDepositor>) => {
            return driftVault.getApplyProfitShareIx(vaultAddress, vd.publicKey);
        }));

        ixChunks.push(ixs);
    }
    console.log(`Sending ${ixChunks.length} transactions...`);

    for (let i = 0; i < ixChunks.length; i++) {
        const ixs = ixChunks[i];
        console.log(`Sending chunk ${i + 1}/${ixChunks.length}`);
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