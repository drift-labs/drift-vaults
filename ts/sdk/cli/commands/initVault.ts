import {
    BN,
    PERCENTAGE_PRECISION,
    PublicKey,
    TEN,
    convertToNumber,
    decodeName,
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

    const newVaultName = cmdOpts.name;
    if (!newVaultName) {
        throw new Error("Must provide vault name with -n/--name");
    }
    const vaultNameBytes = encodeName(newVaultName!);

    let spotMarketIndex = cmdOpts.marketIndex;
    if (!spotMarketIndex) {
        spotMarketIndex = "0";
    }
    spotMarketIndex = parseInt(spotMarketIndex);
    const spotMarket = driftClient.getSpotMarketAccount(spotMarketIndex); // takes USDC deposits
    if (!spotMarket) {
        throw new Error("No spot market found");
    }
    const spotPrecision = TEN.pow(new BN(spotMarket.decimals));
    const spotMarketName = decodeName(spotMarket.name);

    let redeemPeriodSec = cmdOpts.redeemPeriod;
    if (!redeemPeriodSec) {
        redeemPeriodSec = (7 * 60 * 60 * 24).toString(); // 7 days
    }
    redeemPeriodSec = parseInt(redeemPeriodSec);

    let maxTokens = cmdOpts.maxTokens;
    if (!maxTokens) {
        maxTokens = "0";
    }
    maxTokens = parseInt(maxTokens);
    const maxTokensBN = new BN(maxTokens).mul(spotPrecision);

    let managementFee = cmdOpts.managementFee;
    if (!managementFee) {
        managementFee = "0";
    }
    managementFee = parseInt(managementFee);
    const managementFeeBN = new BN(managementFee).mul(PERCENTAGE_PRECISION).div(new BN(100));

    let profitShare = cmdOpts.profitShare;
    if (!profitShare) {
        profitShare = "0";
    }
    profitShare = parseInt(profitShare);
    const profitShareBN = new BN(profitShare).mul(PERCENTAGE_PRECISION).div(new BN(100));

    let permissioned = cmdOpts.permissioned;
    if (!permissioned) {
        permissioned = false;
    }

    let minDepositAmount = cmdOpts.minDepositAmount;
    if (!minDepositAmount) {
        minDepositAmount = "0";
    }
    minDepositAmount = parseInt(minDepositAmount);
    const minDepositAmountBN = new BN(minDepositAmount).mul(spotPrecision);

    let delegate = cmdOpts.delegate;
    if (!delegate) {
        delegate = driftClient.wallet.publicKey;
    } else {
        try {
            delegate = new PublicKey(delegate);
        } catch (err) {
            console.error(`Invalid delegate address: ${err}`);
            delegate = driftClient.wallet.publicKey;
        }
    }

    console.log(`Initializing a new vault with params:`);
    console.log(`  VaultName:              ${newVaultName}`);
    console.log(`  DepositSpotMarketIndex: ${spotMarketIndex} (${spotMarketName})`);
    console.log(`  MaxTokens:              ${convertToNumber(maxTokensBN, spotPrecision)} ${spotMarketName}`);
    console.log(`  MinDepositAmount:       ${convertToNumber(minDepositAmountBN, spotPrecision)} ${spotMarketName}`);
    console.log(`  ManagementFee:          ${convertToNumber(managementFeeBN, PERCENTAGE_PRECISION) * 100.0}%`);
    console.log(`  ProfitShare:            ${convertToNumber(profitShareBN, PERCENTAGE_PRECISION) * 100.0}%`);
    console.log(`  Permissioned:           ${permissioned}`);
    console.log(`  Delegate:               ${delegate.toBase58()}`);

    const readline = require('readline').createInterface({
        input: process.stdin,
        output: process.stdout
    });
    console.log('');
    const answer = await new Promise(resolve => {
        readline.question('Is the above information correct? (yes/no) ', (answer) => {
            readline.close();
            resolve(answer);
        });
    });
    if ((answer as string).toLowerCase() !== 'yes') {
        console.log('Initialization cancelled.');
        readline.close();
        process.exit(0);
    }
    console.log('Creating vault...');

    const initTx = await driftVault.initializeVault({
        name: vaultNameBytes,
        spotMarketIndex,
        redeemPeriod: new BN(redeemPeriodSec),
        maxTokens: maxTokensBN,
        managementFee: managementFeeBN,
        profitShare: profitShareBN.toNumber(),
        hurdleRate: 0,
        permissioned,
        minDepositAmount: minDepositAmountBN,
    });
    console.log(`Initialized vault, tx: https://solscan.io/tx/${initTx}`);

    const vaultAddress = getVaultAddressSync(VAULT_PROGRAM_ID, vaultNameBytes);
    console.log(`\nNew vault address: ${vaultAddress}\n`);

    console.log(`Updating the drift account delegate to: ${delegate}...`);
    const updateDelegateTx = await driftVault.updateDelegate(vaultAddress, delegate);
    console.log(`update delegate tx: https://solscan.io/tx/${updateDelegateTx}`);
};