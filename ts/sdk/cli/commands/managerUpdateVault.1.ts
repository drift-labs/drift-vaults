import { PublicKey } from "@solana/web3.js";
import {
    OptionValues,
    Command
} from "commander";
import { getCommandContext } from "../utils";
import { BN, TEN } from "@drift-labs/sdk";


export const managerUpdateVault = async (program: Command, cmdOpts: OptionValues) => {

    let vaultAddress: PublicKey;
    try {
        vaultAddress = new PublicKey(cmdOpts.vaultAddress as string);
    } catch (err) {
        console.error("Invalid vault address");
        process.exit(1);
    }

    const {
        driftVault, driftClient,
    } = await getCommandContext(program, true);


    let spotMarketIndex = cmdOpts.marketIndex;
    if (!spotMarketIndex) {
        spotMarketIndex = "0";
    }
    spotMarketIndex = parseInt(spotMarketIndex);
    const spotMarket = driftClient.getSpotMarketAccount(spotMarketIndex); // takes USDC deposits
    if (!spotMarket) {
        throw new Error("No spot market found");
    }
    const spotPrecision = TEN.pow(new BN(spotMarket.decimals));
    const spotMarketName = decodeName(spotMarket.name);

    let redeemPeriodSec = cmdOpts.redeemPeriod;
    if (!redeemPeriodSec) {
        redeemPeriodSec = (7 * 60 * 60 * 24).toString(); // 7 days
    }
    redeemPeriodSec = parseInt(redeemPeriodSec);

    let maxTokens = cmdOpts.maxTokens;
    if (!maxTokens) {
        maxTokens = "0";
    }
    maxTokens = parseInt(maxTokens);
    const maxTokensBN = new BN(maxTokens).mul(spotPrecision);

    let managementFee = cmdOpts.managementFee;
    if (!managementFee) {
        managementFee = "0";
    }
    managementFee = parseInt(managementFee);
    const managementFeeBN = new BN(managementFee).mul(PERCENTAGE_PRECISION).div(new BN(100));

    let profitShare = cmdOpts.profitShare;
    if (!profitShare) {
        profitShare = "0";
    }
    profitShare = parseInt(profitShare);
    const profitShareBN = new BN(profitShare).mul(PERCENTAGE_PRECISION).div(new BN(100));

    let permissioned = cmdOpts.permissioned;
    if (!permissioned) {
        permissioned = false;
    }

    let minDepositAmount = cmdOpts.minDepositAmount;
    if (!minDepositAmount) {
        minDepositAmount = "0";
    }
    minDepositAmount = parseInt(minDepositAmount);
    const minDepositAmountBN = new BN(minDepositAmount).mul(spotPrecision);

    // null means unchanged
    const newParams = {
        redeemPeriod: null, // new BN(30 * 60 * 60 * 24), // 30 days
        maxTokens: new BN("5000000000000"),
        managementFee: null,
        minDepositAmount: null, //new BN("1000000000"),
        profitShare: null,
        hurdleRate: null,
        permissioned: null,
    };

    const tx = await driftVault.managerUpdateVault(vaultAddress, newParams);
    console.log(`Updated vault params as vault manager: https://solscan.io/tx/${tx}`);
};
