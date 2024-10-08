import { BN, TEN } from "@drift-labs/sdk";
import { PublicKey } from "@solana/web3.js";
import {
    OptionValues,
    Command
} from "commander";
import { getCommandContext } from "../utils";

export const deposit = async (program: Command, cmdOpts: OptionValues) => {

    let vaultDepositorAddress: PublicKey;
    try {
        vaultDepositorAddress = new PublicKey(cmdOpts.vaultDepositorAddress as string);
    } catch (err) {
        console.error("Invalid vault depositor address");
        process.exit(1);
    }

    const {
        driftClient,
        driftVault
    } = await getCommandContext(program, true);

    const vaultDepositorAccount =
        await driftVault.program.account.vaultDepositor.fetch(vaultDepositorAddress);
    const vaultAddress = vaultDepositorAccount.vault;
    const vaultAccount = await driftVault.program.account.vault.fetch(vaultAddress);
    const spotMarket = driftClient.getSpotMarketAccount(vaultAccount.spotMarketIndex);
    if (!spotMarket) {
        throw new Error("No spot market found");
    }
    const spotPrecision = TEN.pow(new BN(spotMarket.decimals));
    const depositBN = new BN(cmdOpts.amount * spotPrecision.toNumber());

    console.log(`depositing: ${depositBN.toString()}`);
    const tx = await driftVault.deposit(vaultDepositorAddress, depositBN);
    console.log(`Deposited ${cmdOpts.amount} to vault as manager: ${tx}`);
};