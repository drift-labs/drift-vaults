import { BN, TEN, decodeName, numberToSafeBN } from "@drift-labs/sdk";
import { PublicKey } from "@solana/web3.js";
import {
    OptionValues,
    Command
} from "commander";
import { getCommandContext } from "../utils";
import { WithdrawUnit } from "../../src/types/types";

export const managerRequestWithdraw = async (program: Command, cmdOpts: OptionValues) => {

    let vaultAddress: PublicKey;
    try {
        vaultAddress = new PublicKey(cmdOpts.vaultAddress as string);
    } catch (err) {
        console.error("Invalid vault address");
        process.exit(1);
    }

    const {
        driftClient, driftVault
    } = await getCommandContext(program, true);

    if (!cmdOpts.shares && !cmdOpts.amount) {
        console.error("One of --shares or --amount must be provided.");
        process.exit(1);
    }

    if (cmdOpts.shares && !cmdOpts.amount) {
        const tx = await driftVault.managerRequestWithdraw(vaultAddress, new BN(cmdOpts.shares), WithdrawUnit.SHARES);
        console.log(`Requested to withraw ${cmdOpts.shares} shares as vault manager: https://solscan.io/tx/${tx}`);
    } else if (cmdOpts.amount && !cmdOpts.shares) {
        const vault = await driftVault.getVault(vaultAddress);
        const spotMarket = driftClient.getSpotMarketAccount(vault.spotMarketIndex);
        if (!spotMarket) {
            console.error("Error: Spot market not found");
            process.exit(1);
        }
        const spotPrecision = TEN.pow(new BN(spotMarket.decimals));
        const amount = parseFloat(cmdOpts.amount);
        const amountBN = numberToSafeBN(amount, spotPrecision);
        console.log(amount);
        console.log(amountBN.toString());
        const tx = await driftVault.managerRequestWithdraw(vaultAddress, amountBN, WithdrawUnit.TOKEN);
        console.log(`Requested to withdraw ${amount} ${decodeName(spotMarket.name)} as vault manager: https://solscan.io/tx/${tx}`);

    } else {
        console.error("Error: Either shares or amount must be provided, but not both.");
        process.exit(1);
    }

};