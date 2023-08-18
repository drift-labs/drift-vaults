import {
    BN,
    PERCENTAGE_PRECISION,
    PublicKey,
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
    const {
        driftClient,
        driftVault
    } = await getCommandContext(program, true);

    const spotMarket = driftClient.getSpotMarketAccount(0); // takes USDC deposits
    if (!spotMarket) {
        throw new Error("No spot market found");
    }
    const spotPrecision = TEN.pow(new BN(spotMarket.decimals));

    let newVaultName = cmdOpts.name;
    if (!newVaultName) {
        newVaultName = "my new vault";
    }
    const vaultNameBytes = encodeName(newVaultName!);
    console.log(`Initializing a new vault named '${newVaultName}'`);

    const initTx = await driftVault.initializeVault({
        name: vaultNameBytes,
        spotMarketIndex: 0,
        redeemPeriod: new BN(3 * 60 * 60), // 3 hours
        maxTokens: new BN(1000).mul(spotPrecision), // 1000 USDC cap
        managementFee: PERCENTAGE_PRECISION.div(new BN(50)), // 2%
        profitShare: PERCENTAGE_PRECISION.div(new BN(5)), // 20%
        hurdleRate: 0,
        permissioned: false,
        minDepositAmount: new BN(10).mul(spotPrecision), // 10 USDC minimum deposit
    });
    console.log(`Initialized vault, tx: ${initTx}`);

    const vaultAddress = getVaultAddressSync(VAULT_PROGRAM_ID, vaultNameBytes);
    console.log(`New vault address: ${vaultAddress}`);

    let delegate = cmdOpts.delegate;
    if (!delegate) {
        delegate = driftClient.wallet.publicKey.toBase58();
    }
    console.log(`Updating the drift account delegate to: ${delegate}`);
    const updateDelegateTx = await driftVault.updateDelegate(vaultAddress, new PublicKey(delegate));
    console.log(`update delegate tx: ${updateDelegateTx}`);
    console.log("Done!");
};