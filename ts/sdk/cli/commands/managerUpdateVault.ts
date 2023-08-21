import { PublicKey } from "@solana/web3.js";
import {
    OptionValues,
    Command
} from "commander";
import { getCommandContext } from "../utils";
import { BN } from "@drift-labs/sdk";

export const managerUpdateVault = async (program: Command, cmdOpts: OptionValues) => {

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

    const newParams = {
        redeemPeriod: new BN(30 * 60 * 60 * 24), // 30 days
        maxTokens: null,
        managementFee: null,
        minDepositAmount: null,
        profitShare: null,
        hurdleRate: null,
        permissioned: null,
    };

    const tx = await driftVault.managerUpdateVault(vaultAddress, newParams);
    console.log(`Updated vault params as vault manager: https://solscan.io/tx/${tx}`);
    console.log("Done!");
};