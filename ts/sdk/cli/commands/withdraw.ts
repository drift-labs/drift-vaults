import { PublicKey } from "@solana/web3.js";
import {
    OptionValues,
    Command
} from "commander";
import { getCommandContext } from "../utils";

export const withdraw = async (program: Command, cmdOpts: OptionValues) => {

    let vaultDepositorAddress: PublicKey;
    try {
        vaultDepositorAddress = new PublicKey(cmdOpts.vaultDepositorAddress as string);
    } catch (err) {
        console.error("Invalid vault depositor address");
        process.exit(1);
    }

    const {
        driftVault
    } = await getCommandContext(program, true);

    const tx = await driftVault.withdraw(vaultDepositorAddress);
    console.log(`Withdrew from vault: ${tx}`);
};