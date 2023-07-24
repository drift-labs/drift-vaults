import { PublicKey } from "@solana/web3.js";
import {
    OptionValues,
    Command
} from "commander";
import { getCommandContext, printVaultDepositor } from "../utils";

export const viewVaultDepositor = async (program: Command, cmdOpts: OptionValues) => {

    let address: PublicKey;
    try {
        address = new PublicKey(cmdOpts.vaultDepositorAddress as string);
    } catch (err) {
        console.error("Invalid vault address");
        process.exit(1);
    }

    const {
        driftVault
    } = await getCommandContext(program, false);

    const vaultDepositor = await driftVault.getVaultDepositor(address);
    printVaultDepositor(vaultDepositor);
    console.log("Done!");
};