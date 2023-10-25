import { PublicKey } from "@solana/web3.js";
import {
    OptionValues,
    Command
} from "commander";
import { getCommandContext } from "../utils";
import { BN, PERCENTAGE_PRECISION, TEN, convertToNumber, decodeName } from "@drift-labs/sdk";

export const managerUpdateVault = async (program: Command, cmdOpts: OptionValues) => {

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
    const spotMarket = driftClient.getSpotMarketAccount(vault.spotMarketIndex);
    if (!spotMarket) {
        throw new Error("No spot market found");
    }
    const spotPrecision = TEN.pow(new BN(spotMarket.decimals));
    const spotMarketName = decodeName(spotMarket.name);

    let redeemPeriodSec = cmdOpts.redeemPeriod ?? null;
    let redeemPeriodBN: BN | null = null;
    if (redeemPeriodSec !== undefined && redeemPeriodSec !== null) {
        redeemPeriodSec = parseInt(redeemPeriodSec);
        redeemPeriodBN = new BN(redeemPeriodSec);
    }

    let maxTokens = cmdOpts.maxTokens;
    let maxTokensBN: BN | null = null;
    if (maxTokens !== undefined && maxTokens !== null) {
        maxTokens = parseInt(maxTokens);
        maxTokensBN = new BN(maxTokens).mul(spotPrecision);
    }

    let managementFee = cmdOpts.managementFee;
    let managementFeeBN: BN | null = null;
    if (managementFee !== undefined && managementFee !== null) {
        managementFee = parseInt(managementFee);
        managementFeeBN = new BN(managementFee).mul(PERCENTAGE_PRECISION).div(new BN(100));
    }

    let profitShare = cmdOpts.profitShare;
    let profitShareNumber: number | null = null;
    if (profitShare !== undefined && profitShare !== null) {
        profitShare = parseInt(profitShare);
        profitShareNumber = profitShare * PERCENTAGE_PRECISION.toNumber() / 100.0;
    }

    const permissioned: boolean | null = (cmdOpts.permissioned === null || cmdOpts.permissioned === undefined) ? null : cmdOpts.permissioned;

    let minDepositAmount = cmdOpts.minDepositAmount;
    let minDepositAmountBN: BN | null = null;
    if (!minDepositAmount) {
        minDepositAmount = parseInt(minDepositAmount);
        minDepositAmountBN = new BN(minDepositAmount).mul(spotPrecision);
    }

    console.log(`Updating params:`);
    console.log(`  RedeemPeriod:           ${vault.redeemPeriod.toNumber()} -> ${redeemPeriodBN}`);
    const maxTokensBefore = convertToNumber(vault.maxTokens, spotPrecision);
    const maxTokensAfter = maxTokensBN ? convertToNumber(maxTokensBN, spotPrecision) : 'unchanged';
    console.log(`  MaxTokens:              ${maxTokensBefore} ${spotMarketName} -> ${maxTokensAfter} ${spotMarketName}`);
    const minDepositAmountBefore = convertToNumber(vault.minDepositAmount, spotPrecision);
    const minDepositAmountAfter = minDepositAmountBN ? convertToNumber(minDepositAmountBN, spotPrecision) : 'unchanged';
    console.log(`  MinDepositAmount:       ${minDepositAmountBefore} ${spotMarketName} -> ${minDepositAmountAfter} ${spotMarketName}`);
    const managementFeeBefore = convertToNumber(vault.managementFee, PERCENTAGE_PRECISION) * 100.0;
    const managementFeeAfter = managementFeeBN ? `${convertToNumber(managementFeeBN, PERCENTAGE_PRECISION) * 100.0}%` : 'unchanged';
    console.log(`  ManagementFee:          ${managementFeeBefore}% -> ${managementFeeAfter}`);
    const profitShareBefore = vault.profitShare / PERCENTAGE_PRECISION.toNumber() * 100.0;
    const profitShareAfter = profitShareNumber !== null ? `${profitShareNumber / PERCENTAGE_PRECISION.toNumber() * 100.0}%` : 'unchanged';
    console.log(`  ProfitShare:            ${profitShareBefore}% -> ${profitShareAfter}`);
    const permissionedBefore = vault.permissioned;
    const permissionedAfter = permissioned !== null ? permissioned : 'unchanged ';
    console.log(`  Permissioned:           ${permissionedBefore} -> ${permissionedAfter}`);

    const readline = require('readline').createInterface({
        input: process.stdin,
        output: process.stdout
    });
    console.log('');
    const answer = await new Promise(resolve => {
        readline.question('Is the above information correct? (yes/no) ', (answer) => {
            readline.close();
            resolve(answer);
        });
    });
    if ((answer as string).toLowerCase() !== 'yes') {
        console.log('Vault update canceled.');
        readline.close();
        process.exit(0);
    }
    console.log('Updating vault...');

    // null means unchanged
    const newParams = {
        redeemPeriod: redeemPeriodBN,
        maxTokens: maxTokensBN,
        minDepositAmount: minDepositAmountBN,
        managementFee: managementFeeBN,
        profitShare: profitShareNumber,
        hurdleRate: null,
        permissioned
    };

    const tx = await driftVault.managerUpdateVault(vaultAddress, newParams);
    console.log(`Updated vault params as vault manager: https://solscan.io/tx/${tx}`);
};