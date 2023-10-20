import { PublicKey } from "@solana/web3.js";
import {
    OptionValues,
    Command
} from "commander";
import { getCommandContext } from "../utils";

export const managerUpdateMarginTradingEnabled= async (program: Command, cmdOpts: OptionValues) => {

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

    const enabled = cmdOpts.enabled ? (cmdOpts.enabled as string).toLowerCase() === "true" : false;

    const tx = await driftVault.updateMarginTradingEnabled(vaultAddress, enabled);
    console.log(`Updated margin trading vault manager: https://solscan.io/tx/${tx}`);
};