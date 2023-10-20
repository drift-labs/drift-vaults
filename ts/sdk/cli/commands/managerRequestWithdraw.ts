import { BN } from "@drift-labs/sdk";
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
        driftVault
    } = await getCommandContext(program, true);

    const tx = await driftVault.managerRequestWithdraw(vaultAddress, new BN(cmdOpts.shares), WithdrawUnit.SHARES);
    console.log(`Requested to withraw ${cmdOpts.shares} shares as vault manager: https://solscan.io/tx/${tx}`);
};