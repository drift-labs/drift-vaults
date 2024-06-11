import { ComputeBudgetProgram, PublicKey, TransactionInstruction, VersionedTransactionResponse } from "@solana/web3.js";
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
    const vaultEquitySpot = await driftVault.calculateVaultEquityInDepositAsset({ vault });

    const spotMarket = driftClient.getSpotMarketAccount(vault.spotMarketIndex);
    if (!spotMarket) {
        throw new Error(`Spot market account ${vault.spotMarketIndex} has not been loaded`);
    }
    const spotMarketPrecision = TEN.pow(new BN(spotMarket.decimals));
    const thresholdNumber = parseFloat(cmdOpts.threshold);
    const thresholdBN = numberToSafeBN(thresholdNumber, spotMarketPrecision);
    let pendingProfitShareToRealize = ZERO;
    const vdWithPendingProfitShare = vdWithNoWithdrawRequests.filter((vd: ProgramAccount<VaultDepositor>) => {
        const pendingProfitShares = calculateApplyProfitShare(vd.account, vaultEquitySpot, vault);
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

    const chunkSize = 1;
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
            ixs.unshift(ComputeBudgetProgram.setComputeUnitPrice({
                microLamports: 10000,
            }));
            ixs.unshift(ComputeBudgetProgram.setComputeUnitLimit({
                units: 170_000,
            }));

            const tx = await driftClient.txSender.getVersionedTransaction(ixs, [], undefined, undefined);

            let attempt = 0;
            let txResp: VersionedTransactionResponse | null = null;
            while (txResp === null) {
                attempt++;
                const { txSig } = await driftClient.txSender.sendVersionedTransaction(
                    tx,
                );
                console.log(`[${i}]: https://solscan.io/tx/${txSig} (attempt ${attempt})`);

                await new Promise(resolve => setTimeout(resolve, 1000));

                txResp = await driftClient.connection.getTransaction(txSig, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 });
            }
            console.log(txResp);


        } catch (e) {
            console.error(e);
            continue;
        }

    }
};