import { PublicKey } from "@solana/web3.js";
import {
    OptionValues,
    Command
} from "commander";
import { getCommandContext } from "../utils";
import { BN, QUOTE_PRECISION, ZERO, convertToNumber } from "@drift-labs/sdk";
import {
    calculateApplyProfitShare,
} from "../../src/math";
import { VaultDepositor } from "../../src";

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
    const approxSlot = await driftVault.driftClient.connection.getSlot();
    const now = Date.now();

    let nonZeroDepositors = allVaultDepositors.filter(vd => vd.account.vaultShares.gt(new BN(0)));
    nonZeroDepositors = nonZeroDepositors.sort((a, b) => b.account.vaultShares.cmp(a.account.vaultShares));

    let totalUserShares = new BN(0);
    let totalUserProfitSharePaid = new BN(0);
    let totalUserProfitShareSharesPaid = new BN(0);
    let totalPendingProfitShareAmount = new BN(0);
    let totalPendingProfitShareShares = new BN(0);

    console.log(`Vault ${vaultAddress} vd and invariant check at approx slot: ${approxSlot}, date: ${new Date(now).toLocaleString()}`);
    console.log(`Depositors with 0 shares: ${allVaultDepositors.length - nonZeroDepositors.length}/${allVaultDepositors.length}`);
    for (const vd of nonZeroDepositors) {
        const vdAccount = vd.account as VaultDepositor;

        totalUserShares = totalUserShares.add(vdAccount.vaultShares);
        const vdAuth = vdAccount.authority.toBase58();
        const vdPct = vdAccount.vaultShares.toNumber() / vault.totalShares.toNumber();
        console.log(`- ${vdAuth} has ${vdAccount.vaultShares.toNumber()} shares (${(vdPct * 100.0).toFixed(2)}% of vault)`);

        if (!vdAccount.lastWithdrawRequest.shares.eq(new BN(0))) {
            const withdrawRequested = vdAccount.lastWithdrawRequest.ts.toNumber();
            const secToWithdrawal = withdrawRequested + vault.redeemPeriod.toNumber() - Date.now() / 1000;
            const withdrawAvailable = secToWithdrawal < 0;
            const pct = vdAccount.lastWithdrawRequest.shares.toNumber() / vd.account.vaultShares.toNumber();
            const daysUntilWithdraw = Math.floor(secToWithdrawal / 86400);
            const hoursUntilWithdraw = Math.floor((secToWithdrawal % 86400) / 3600);

            console.log(`  - pending withdrawal: ${vdAccount.lastWithdrawRequest.shares.toString()} ($${convertToNumber(vd.account.lastWithdrawRequest.value, spotPrecision)}), ${(pct * 100.00).toFixed(2)}% of their deposit ${withdrawAvailable ? "<--- WITHDRAWABLE" : ""}`);
            console.log(`    - requested at: ${new Date(withdrawRequested * 1000).toISOString()}`);
            console.log(`    - can withdraw in: ${daysUntilWithdraw} days and ${hoursUntilWithdraw} hours`);
        }

        totalUserProfitSharePaid = totalUserProfitSharePaid.add(vdAccount.profitShareFeePaid);
        totalUserProfitShareSharesPaid = totalUserProfitShareSharesPaid.add(vdAccount.cumulativeProfitShareAmount);

        const pendingProfitShares = calculateApplyProfitShare(vdAccount, vaultEquity, vault);
        if (pendingProfitShares.profitShareAmount.gt(ZERO)) {
            totalPendingProfitShareAmount = totalPendingProfitShareAmount.add(pendingProfitShares.profitShareAmount);
            totalPendingProfitShareShares = totalPendingProfitShareShares.add(pendingProfitShares.profitShareShares);
            console.log(`  - pending profit share amount: $${convertToNumber(pendingProfitShares.profitShareAmount, spotPrecision)}`);
        }
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

    console.log(``);
    console.log(`==== Pending profit shares to realize ====`);
    console.log(`${convertToNumber(totalPendingProfitShareAmount, spotPrecision)}`);
    console.log(`csv: ${cmdOpts.csv}`);

    console.log(``);
    console.log(`==== Manager share ====`);
    console.log(`  Vault total shares: ${vault.totalShares.toNumber()}`);
    const managerShares = vault.totalShares.sub(vault.userShares);
    const managerSharePct = managerShares.toNumber() / vault.totalShares.toNumber();
    const managerShareWithPendingPct = managerShares.add(totalPendingProfitShareShares).toNumber() / vault.totalShares.toNumber();
    console.log(`  Manager shares: ${managerShares.toString()} (${(managerSharePct * 100.0).toFixed(4)}%)`);
    const vaultEquityNum = convertToNumber(vaultEquity, QUOTE_PRECISION);
    console.log(`vaultEquity (USDC):   $${vaultEquityNum}`);
    console.log(`manager share (w/o pending) (USDC):  $${managerSharePct * vaultEquityNum}`);
    console.log(`manager share (with pending) (USDC): $${managerShareWithPendingPct * vaultEquityNum}`);
};