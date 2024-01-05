import { PublicKey } from "@solana/web3.js";
import {
    OptionValues,
    Command
} from "commander";
import { getCommandContext } from "../utils";
import { BN, convertToNumber } from "@drift-labs/sdk";
import {
    calculateApplyProfitShare,
} from "../../src/math";

export const vaultInvariantChecks = async (program: Command, cmdOpts: OptionValues) => {

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

    /*
    Invariants:
    * sum(vault_depositors.shares) == vault.user_shares
    * sum(vault_depositors.profit_share_paid) == vault.manager_total_profit_share
    */


    const vault = await driftVault.getVault(vaultAddress);
    const vaultEquity = await driftVault.calculateVaultEquity({
        vault,
    });
    const spotMarket = driftVault.driftClient.getSpotMarketAccount(vault.spotMarketIndex);
    const spotPrecision = new BN(10).pow(new BN(spotMarket!.decimals));

    const allVaultDepositors = await driftVault.getAllVaultDepositors(vaultAddress);

    let totalUserShares = new BN(0);
    let totalUserProfitSharePaid = new BN(0);

    for (const vd of allVaultDepositors) {
        totalUserShares = totalUserShares.add(vd.account.vaultShares);
        if (!vd.account.lastWithdrawRequest.shares.eq(new BN(0))) {
            const pct = vd.account.lastWithdrawRequest.shares.toNumber() / vd.account.vaultShares.toNumber();
            console.log(`Vd has withdrawal ${vd.publicKey.toBase58()} (auth: ${vd.account.authority.toBase58()}): ${vd.account.lastWithdrawRequest.shares.toString()} ($${convertToNumber(vd.account.lastWithdrawRequest.value, spotPrecision)}), ${(pct * 100.00).toFixed(2)}%`);
        }

        if (!vd.account.cumulativeProfitShareAmount.eq(new BN(0))) {
            // const profitSharePaid = vd.account.profitShareFeePaid.toNumber() / vd.account.cumulativeProfitShareAmount.toNumber();
            // console.log(`Profit share paid: ${vd.publicKey.toBase58()} (auth: ${vd.account.authority.toBase58()}): ${Math.ceil(profitSharePaid * 100.0)}%`);
        }
        totalUserProfitSharePaid = totalUserProfitSharePaid.add(vd.account.profitShareFeePaid);

        const pendingProfitShares = calculateApplyProfitShare(vd.account, vaultEquity, vault);
        console.log(`Pending profit shares: ${vd.publicKey.toBase58()} (auth: ${vd.account.authority.toBase58()}): $${convertToNumber(pendingProfitShares.profitShareAmount, spotPrecision)}`);
        console.log(` . ${pendingProfitShares.profitShareShares}, ${pendingProfitShares.profitShareAmount}`);
    }
    console.log(`==== Vault Depositor Shares == vault.user_shares ====`);
    console.log(`total vd shares:        ${totalUserShares.toString()}`);
    console.log(`total vault usershares: ${vault.userShares.toString()}`);
    console.log(`diff: ${vault.userShares.sub(totalUserShares)}`);

    console.log(``);
    console.log(`==== Vault Depositor ProfitSharePaid == vault.manager_total_profit_share ====`);
    console.log(`total vault d profitshares: ${totalUserProfitSharePaid.toString()}`);
    console.log(`vault total profit shares:  ${vault.managerTotalProfitShare.toString()}`);
    console.log(`diff: ${vault.managerTotalProfitShare.sub(totalUserProfitSharePaid)}`);
};