import { PublicKey } from "@solana/web3.js";
import {
    OptionValues,
    Command
} from "commander";
import { getCommandContext, printVault } from "../utils";
import { BN, PRICE_PRECISION, QUOTE_PRECISION, TEN, convertToNumber, decodeName } from "@drift-labs/sdk";

export const viewVault = async (program: Command, cmdOpts: OptionValues) => {

    let address: PublicKey;
    try {
        address = new PublicKey(cmdOpts.vaultAddress as string);
    } catch (err) {
        console.error("Invalid vault address");
        process.exit(1);
    }

    const {
        driftVault,
        driftClient,
    } = await getCommandContext(program, false);


    const vault = await driftVault.getVault(address);
    const { managerSharePct } = printVault(vault);
    const vaultEquity = await driftVault.calculateVaultEquity({
        vault,
    });

    const spotMarket = driftClient.getSpotMarketAccount(vault.spotMarketIndex);
    if (!spotMarket) {
        throw new Error(`Spot market ${vault.spotMarketIndex} not found`);
    }
    const spotOracle = driftClient.getOracleDataForSpotMarket(vault.spotMarketIndex);
    if (!spotOracle) {
        throw new Error(`Spot oracle ${vault.spotMarketIndex} not found`);
    }
    const oraclePriceNum = convertToNumber(spotOracle.price, PRICE_PRECISION);
    const spotPrecision = TEN.pow(new BN(spotMarket.decimals));
    const spotSymbol = decodeName(spotMarket.name);

    const vaultEquityNum = convertToNumber(vaultEquity, QUOTE_PRECISION);
    const netDepositsNum = convertToNumber(vault.netDeposits, spotPrecision);
    console.log(`vaultEquity (USDC):   $${vaultEquityNum}`);
    console.log(`manager share (USDC): $${managerSharePct * vaultEquityNum}`);
    console.log(`vault PnL (USDC):     $${vaultEquityNum - netDepositsNum}`);

    const vaultEquitySpot = vaultEquityNum / oraclePriceNum;

    console.log(`vaultEquity (${spotSymbol}):   ${vaultEquitySpot}`);
    console.log(`manager share (${spotSymbol}): ${managerSharePct * vaultEquitySpot}`);
    console.log(`vault PnL (${spotSymbol}):     ${vaultEquitySpot - netDepositsNum}`);
};