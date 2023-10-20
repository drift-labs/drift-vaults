import { PublicKey } from "@solana/web3.js";
import {
    OptionValues,
    Command
} from "commander";
import { getCommandContext } from "../utils";

export const managerWithdraw = async (program: Command, cmdOpts: OptionValues) => {

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

    const tx = await driftVault.managerWithdraw(vaultAddress);
    console.log(`Withrew as vault manager: https://solscan.io/tx/${tx}`);
};