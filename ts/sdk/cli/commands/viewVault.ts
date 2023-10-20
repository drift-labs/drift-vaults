import { PublicKey } from "@solana/web3.js";
import {
    OptionValues,
    Command
} from "commander";
import { getCommandContext, printVault } from "../utils";
import { QUOTE_PRECISION, convertToNumber } from "@drift-labs/sdk";

export const viewVault = async (program: Command, cmdOpts: OptionValues) => {

    let address: PublicKey;
    try {
        address = new PublicKey(cmdOpts.vaultAddress as string);
    } catch (err) {
        console.error("Invalid vault address");
        process.exit(1);
    }

    const {
        driftVault
    } = await getCommandContext(program, false);

    const vault = await driftVault.getVault(address);
    const { managerSharePct } = printVault(vault);
    const vaultEquity = await driftVault.calculateVaultEquity({
        vault,
    });
    console.log(`vaultEquity: $${convertToNumber(vaultEquity, QUOTE_PRECISION)}`);
    console.log(`manager share: $${managerSharePct * convertToNumber(vaultEquity, QUOTE_PRECISION)}`);
};