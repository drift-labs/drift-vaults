import { BN } from "@drift-labs/sdk";
import { PublicKey } from "@solana/web3.js";
import {
    OptionValues,
    Command
} from "commander";
import { getCommandContext } from "../utils";
import { WithdrawUnit } from "../../src/types/types";
import { getVaultDepositorAddressSync, VAULT_PROGRAM_ID } from "../../src";

export const requestWithdraw = async (program: Command, cmdOpts: OptionValues) => {

    // verify correct args provided
    if (!cmdOpts.vaultDepositorAddress) {
        if (!cmdOpts.vaultAddress || !cmdOpts.authority) {
            console.error("Must provide --vault-address and --authority if not providing --vault-depositor-address");
            process.exit(1);
        }
    }

    const {
        driftVault,
        driftClient
    } = await getCommandContext(program, true);

    let vaultDepositorAddress: PublicKey;
    if (cmdOpts.vaultDepositorAddress) {
        try {
            vaultDepositorAddress = new PublicKey(cmdOpts.vaultDepositorAddress as string);
        } catch (err) {
            console.error("Invalid vault depositor address");
            process.exit(1);
        }
    } else {
        const vaultAddress = new PublicKey(cmdOpts.vaultAddress as string);
        const authority = new PublicKey(cmdOpts.authority as string);
        vaultDepositorAddress = getVaultDepositorAddressSync(VAULT_PROGRAM_ID, vaultAddress, authority);
    }

    const withdrawAmountBN = new BN(cmdOpts.amount);

    if (cmdOpts.simulate) {
        // Simulate the transaction
        const authority = cmdOpts.authority ? new PublicKey(cmdOpts.authority) : driftVault.driftClient.wallet.publicKey;
        console.log(`\nSimulating request withdraw as authority: ${authority}`);
        console.log(`Amount: ${cmdOpts.amount} shares`);
        
        try {
            await driftVault.requestWithdraw(vaultDepositorAddress, withdrawAmountBN, WithdrawUnit.SHARES, {
                simulateTransaction: true,
                simulationAuthority: authority
            });
        } catch (error) {
            // Error details are already logged by vaultClient
            process.exit(1);
        }
    } else {
        const tx = await driftVault.requestWithdraw(vaultDepositorAddress, withdrawAmountBN, WithdrawUnit.SHARES);
        console.log(`Requested to withdraw ${cmdOpts.amount} shares from the vault: https://solana.fm/tx/${tx}${driftClient.env === "devnet" ? "?cluster=devnet-solana" : ""}`);
    }
};