import { Command } from 'commander';
import { FuelDistributionMode } from '../../src/types/types';
import { PublicKey } from '@solana/web3.js';
import { dumpTransactionMessage, getCommandContext } from '../utils';

export async function managerUpdateFuelDistributionMode(
    program: Command,
    opts: {
        vaultAddress: string;
        fuelDistributionMode: string;
        dumpTransactionMessage?: boolean;
    }
) {
    const { driftVault, driftClient } = await getCommandContext(program, true);

    const fuelDistributionModeStr = opts.fuelDistributionMode.toLowerCase();
    let fuelDistributionMode: FuelDistributionMode;
    if (fuelDistributionModeStr === 'users-only') {
        fuelDistributionMode = FuelDistributionMode.UsersOnly;
    } else if (fuelDistributionModeStr === 'users-and-manager') {
        fuelDistributionMode = FuelDistributionMode.UsersAndManager;
    } else {
        throw new Error(`Invalid fuel distribution mode: ${opts.fuelDistributionMode}. Valid modes are: users-only, users-and-manager`);
    }

    if (opts.dumpTransactionMessage) {
        const ix = await driftVault.getManagerUpdateFuelDistributionModeIx(
            new PublicKey(opts.vaultAddress),
            fuelDistributionMode
        );
        console.log(dumpTransactionMessage(driftClient.wallet.publicKey, [ix]));
    } else {
        const tx = await driftVault.managerUpdateFuelDistributionMode(
            new PublicKey(opts.vaultAddress),
            fuelDistributionMode
        );
        console.log(`Updated fuel distribution mode to '${fuelDistributionMode}': https://solana.fm/tx/${tx}${driftClient.env === "devnet" ? "?cluster=devnet-solana" : ""}`);
    }
} 