import { BN, TEN } from "@drift-labs/sdk";
import { PublicKey } from "@solana/web3.js";
import {
    OptionValues,
    Command
} from "commander";
import { getCommandContext } from "../utils";

export const deposit = async (program: Command, cmdOpts: OptionValues) => {

    let vaultDepositorAddress: PublicKey;
    try {
        vaultDepositorAddress = new PublicKey(cmdOpts.vaultDepositorAddress as string);
    } catch (err) {
        console.error("Invalid vault depositor address");
        process.exit(1);
    }

    const {
        driftClient,
        driftVault
    } = await getCommandContext(program, true);

    const spotMarket = driftClient.getSpotMarketAccount(0); // takes USDC deposits
    if (!spotMarket) {
        throw new Error("No spot market found");
    }
    const spotPrecision = TEN.pow(new BN(spotMarket.decimals));
    const depositBN = new BN(cmdOpts.amount * spotPrecision.toNumber());

    console.log(`depositing: ${depositBN.toString()}`);
    const tx = await driftVault.deposit(vaultDepositorAddress, depositBN);
    console.log(`Deposited ${cmdOpts.amount} to vault as manager: ${tx}`);
    console.log("Done!");
};