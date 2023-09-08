import { DriftClient, PublicKey, Wallet, loadKeypair } from "@drift-labs/sdk";
import { Vault, VaultClient, decodeName } from "../src";
import { Command } from "commander";
import { Connection, Keypair } from "@solana/web3.js";
import { AnchorProvider } from "@coral-xyz/anchor";
import * as anchor from '@coral-xyz/anchor';
import { IDL } from "../src/types/drift_vaults";

export function printVault(vault: Vault) {
    console.log(`vault: ${decodeName(vault.name)}`);
    console.log(`pubkey:         ${vault.pubkey.toBase58()}`);
    console.log(`manager:         ${vault.manager.toBase58()}`);
    console.log(`tokenAccount:    ${vault.tokenAccount.toBase58()}`);
    console.log(`driftUserStats:  ${vault.userStats.toBase58()}`);
    console.log(`driftUser:       ${vault.user.toBase58()}`);
    console.log(`delegate:        ${vault.delegate.toBase58()}`);
    console.log(`liqDelegate:     ${vault.liquidationDelegate.toBase58()}`);
    console.log(`userShares:      ${vault.userShares.toString()}`);
    console.log(`totalShares:     ${vault.totalShares.toString()}`);
    const managerShares = vault.totalShares.sub(vault.userShares);
    console.log(`  [managerShares]: ${managerShares.toString()} (${(managerShares.toNumber() / vault.totalShares.toNumber() * 100.0).toFixed(4)}%)`);
    console.log(`totalShares:     ${vault.totalShares.toString()}`);
    console.log(`lastFeeUpdateTs:    ${vault.lastFeeUpdateTs.toString()}`);
    console.log(`liquidationStartTs: ${vault.liquidationStartTs.toString()}`);
    console.log(`redeemPeriod:            ${vault.redeemPeriod.toString()}`);
    console.log(`totalWithdrawRequested:  ${vault.totalWithdrawRequested.toString()}`);
    console.log(`maxTokens:               ${vault.maxTokens.toString()}`);
    console.log(`sharesBase:              ${vault.sharesBase}`);
    console.log(`managementFee:           ${vault.managementFee.toString()}`);
    console.log(`initTs:                  ${vault.initTs.toString()}`);
    console.log(`netDeposits:             ${vault.netDeposits.toString()}`);
    console.log(`managerNetDeposits:      ${vault.managerNetDeposits.toString()}`);
    console.log(`totalDeposits:           ${vault.totalDeposits.toString()}`);
    console.log(`totalWithdraws:          ${vault.totalWithdraws.toString()}`);
    console.log(`managerTotalDeposits:    ${vault.managerTotalDeposits.toString()}`);
    console.log(`managerTotalWithdraws:   ${vault.managerTotalWithdraws.toString()}`);
    console.log(`managerTotalFee:         ${vault.managerTotalFee.toString()}`);
    console.log(`managerTotalProfitShare: ${vault.managerTotalProfitShare.toString()}`);
    console.log(`lastManagerWithdrawRequest:`);
    console.log(`  shares: ${vault.lastManagerWithdrawRequest.shares.toString()}`);
    console.log(`  values: ${vault.lastManagerWithdrawRequest.value.toString()}`);
    console.log(`  ts:     ${vault.lastManagerWithdrawRequest.ts.toString()}`);

    console.log(`minDepositAmount:  ${vault.minDepositAmount.toString()}`);
    console.log(`profitShare:       ${vault.profitShare}`);
    console.log(`hurdleRate:        ${vault.hurdleRate}`);
    console.log(`spotMarketIndex:   ${vault.spotMarketIndex}`);
    console.log(`permissioned:      ${vault.permissioned}`);
}

export function printVaultDepositor(vaultDepositor) {
    console.log(`vault:          ${vaultDepositor.vault.toBase58()}`);
    console.log(`pubkey:         ${vaultDepositor.pubkey.toBase58()}`);
    console.log(`authority:      ${vaultDepositor.authority.toBase58()}`);
    console.log(`vaultShares:    ${vaultDepositor.vaultShares.toString()}`);
    console.log(`lastWithdrawRequestShares:   ${vaultDepositor.lastWithdrawRequestShares.toString()}`);
    console.log(`lastWithdrawRequestValue:    ${vaultDepositor.lastWithdrawRequestValue.toString()}`);
    console.log(`lastWithdrawRequestTs:       ${vaultDepositor.lastWithdrawRequestTs.toString()}`);
    console.log(`lastValidTs:                 ${vaultDepositor.lastValidTs.toString()}`);
    console.log(`netDeposits:                 ${vaultDepositor.netDeposits.toString()}`);
    console.log(`totalDeposits:               ${vaultDepositor.totalDeposits.toString()}`);
    console.log(`totalWithdraws:              ${vaultDepositor.totalWithdraws.toString()}`);
    console.log(`cumulativeProfitShareAmount: ${vaultDepositor.cumulativeProfitShareAmount.toString()}`);
    console.log(`vaultSharesBase:             ${vaultDepositor.vaultSharesBase.toString()}`);
}

export async function getCommandContext(program: Command, needToSign: boolean): Promise<{
    driftClient: DriftClient,
    driftVault: VaultClient,
}> {

    const opts = program.opts();

    let keypair: Keypair;
    if (needToSign) {
        try {
            keypair = loadKeypair(opts.keypair as string);
        } catch (e) {
            console.error(`Need to provide a valid keypair: ${e}`);
            process.exit(1);
        }
    } else {
        keypair = Keypair.generate();
    }

    const wallet = new Wallet(keypair);
    console.log(`Signing wallet address (need to sign: ${needToSign}): `, wallet.publicKey.toBase58());

    const connection = new Connection(opts.rpc, {
        commitment: opts.commitment,
    });
    const driftClient = new DriftClient({
        connection,
        wallet,
        env: "mainnet-beta",
        opts: {
            commitment: opts.commitment,
            skipPreflight: false,
            preflightCommitment: opts.commitment,
        },
    });
    await driftClient.subscribe();

    const provider = new AnchorProvider(connection, wallet, {});
    anchor.setProvider(provider);
    const vaultProgramId = new PublicKey("vAuLTsyrvSfZRuRB3XgvkPwNGgYSs9YRYymVebLKoxR");
    const vaultProgram = new anchor.Program(IDL, vaultProgramId, provider);

    const driftVault = new VaultClient({
        driftClient,
        program: vaultProgram,
        cliMode: true
    });

    return {
        driftClient,
        driftVault,
    };
}