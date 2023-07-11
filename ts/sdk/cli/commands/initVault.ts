import {
    BN,
    PERCENTAGE_PRECISION,
    TEN,
} from "@drift-labs/sdk";
import {
    OptionValues,
    Command
} from "commander";
import {
    encodeName,
    getVaultAddressSync,
} from "../../src";
import { getCommandContext } from "../utils";
import { VAULT_PROGRAM_ID } from "../../src/types/types";

export const initVault = async (program: Command, cmdOpts: OptionValues) => {
    let newVaultName = cmdOpts.name;
    if (!newVaultName) {
        newVaultName = "my new vault";
    }
    const vaultNameBytes = encodeName(newVaultName!);

    const {
        driftClient,
        driftVault
    } = await getCommandContext(program, true);

    const spotMarket = driftClient.getSpotMarketAccount(0); // takes USDC deposits
    if (!spotMarket) {
        throw new Error("No spot market found");
    }
    const spotPrecision = TEN.pow(new BN(spotMarket.decimals));

    console.log(`Initializing a new vault named '${newVaultName}'`);

    const initTx = await driftVault.initializeVault({
        name: vaultNameBytes,
        spotMarketIndex: 0,
        redeemPeriod: new BN(3 * 60 * 60), // 3 hours
        maxTokens: new BN(100).mul(spotPrecision), // 100 USDC cap
        managementFee: PERCENTAGE_PRECISION.div(new BN(50)), // 2%
        profitShare: PERCENTAGE_PRECISION.div(new BN(5)), // 20%
        hurdleRate: 0,
        permissioned: true,
    });
    console.log(`Initialized vault, tx: ${initTx}`);

    const vaultAddress = getVaultAddressSync(VAULT_PROGRAM_ID, vaultNameBytes);
    console.log(`New vault address: ${vaultAddress}`);

    console.log(`Updating the drift account delegate to your vault manager key: ${driftClient.wallet.publicKey.toBase58()}`);
    const updateDelegateTx = await driftVault.updateDelegate(vaultAddress, driftClient.wallet.publicKey);
    console.log(`update delegate tx: ${updateDelegateTx}`);
    console.log("Done!");
};