import { BN } from "@drift-labs/sdk";
import { PublicKey } from "@solana/web3.js";
import {
    OptionValues,
    Command
} from "commander";
import { getCommandContext } from "../utils";
import { WithdrawUnit } from "../../src/types/types";

export const requestWithdraw = async (program: Command, cmdOpts: OptionValues) => {

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

    const withdrawAmountBN = new BN(cmdOpts.amount);

    const tx = await driftVault.requestWithdraw(vaultDepositorAddress, withdrawAmountBN, WithdrawUnit.SHARES);
    console.log(`Requsted to withdraw ${cmdOpts.amount} shares from the vault: ${tx}`);
};