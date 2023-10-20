import { PublicKey } from "@solana/web3.js";
import {
    OptionValues,
    Command
} from "commander";
import { getCommandContext } from "../utils";

export const managerUpdateVaultDelegate = async (program: Command, cmdOpts: OptionValues) => {

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

    let delegate = cmdOpts.delegate;
    if (!delegate) {
        throw new Error(`Must provide delegate address`);
    } else {
        try {
            delegate = new PublicKey(delegate);
        } catch (err) {
            throw new Error(`Invalid delegate address: ${err}`);
        }
    }

    const tx = await driftVault.updateDelegate(vaultAddress, delegate);
    console.log(`Updated vault delegate to ${delegate.toBase58()}: https://solscan.io/tx/${tx}`);
};