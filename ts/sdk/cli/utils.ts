import { BASE_PRECISION, BN, DriftClient, OraclePriceData, PRICE_PRECISION, QUOTE_PRECISION, SpotMarketAccount, TEN, User, Wallet, WhileValidTxSender, convertToNumber, getSignedTokenAmount, getTokenAmount, loadKeypair } from "@drift-labs/sdk";
import { VAULT_PROGRAM_ID, Vault, VaultClient, VaultDepositor, decodeName } from "../src";
import { Command } from "commander";
import { Connection, Keypair } from "@solana/web3.js";
import { AnchorProvider } from "@coral-xyz/anchor";
import * as anchor from '@coral-xyz/anchor';
import { IDL } from "../src/types/drift_vaults";

export async function printVault(slot: number, driftClient: DriftClient, vault: Vault, vaultEquity: BN, spotMarket: SpotMarketAccount, spotOracle: OraclePriceData) {

    const oraclePriceNum = convertToNumber(spotOracle.price, PRICE_PRECISION);
    const spotPrecision = TEN.pow(new BN(spotMarket.decimals));
    const spotSymbol = decodeName(spotMarket.name);

    console.log(`slot: ${slot}`);
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
    const managerSharePct = managerShares.toNumber() / vault.totalShares.toNumber();
    console.log(`  [managerShares]: ${managerShares.toString()} (${(managerSharePct * 100.0).toFixed(4)}%)`);
    console.log(`totalShares:     ${vault.totalShares.toString()}`);
    console.log(`lastFeeUpdateTs:    ${vault.lastFeeUpdateTs.toString()}`);
    console.log(`liquidationStartTs: ${vault.liquidationStartTs.toString()}`);
    console.log(`redeemPeriod:            ${vault.redeemPeriod.toString()}`);
    console.log(`totalWithdrawRequested:  ${vault.totalWithdrawRequested.toString()}`);
    console.log(`maxTokens:               ${convertToNumber(vault.maxTokens, spotPrecision)} ${spotSymbol} (${vault.maxTokens.toString()})`);
    console.log(`sharesBase:              ${vault.sharesBase}`);
    console.log(`managementFee:           ${vault.managementFee.toString()}`);
    console.log(`initTs:                  ${vault.initTs.toString()}`);
    console.log(`netDeposits:             ${convertToNumber(vault.netDeposits, spotPrecision)} ${spotSymbol} (${vault.netDeposits.toString()})`);
    console.log(`totalDeposits:           ${convertToNumber(vault.totalDeposits, spotPrecision)} ${spotSymbol} (${vault.totalDeposits.toString()})`);
    console.log(`totalWithdraws:           ${convertToNumber(vault.totalWithdraws, spotPrecision)} ${spotSymbol} (${vault.totalWithdraws.toString()})`);
    console.log(`managerNetDeposits:      ${convertToNumber(vault.managerNetDeposits, spotPrecision)} ${spotSymbol} (${vault.managerNetDeposits.toString()})`);
    console.log(`managerTotalDeposits:    ${convertToNumber(vault.managerTotalDeposits, spotPrecision)} ${spotSymbol} (${vault.managerTotalDeposits.toString()})`);
    console.log(`managerTotalWithdraws:   ${convertToNumber(vault.managerTotalWithdraws, spotPrecision)} ${spotSymbol} (${vault.managerTotalWithdraws.toString()})`);
    console.log(`managerTotalFee:         ${convertToNumber(vault.managerTotalFee, spotPrecision)} ${spotSymbol} (${vault.managerTotalFee.toString()})`);
    console.log(`managerTotalProfitShare: ${convertToNumber(vault.managerTotalProfitShare, spotPrecision)} ${spotSymbol} (${vault.managerTotalProfitShare.toString()})`);
    console.log(`lastManagerWithdrawRequest:`);
    console.log(`  shares: ${vault.lastManagerWithdrawRequest.shares.toString()}`);
    console.log(`  values: ${convertToNumber(vault.lastManagerWithdrawRequest.value, spotPrecision)} ${spotSymbol} (${vault.lastManagerWithdrawRequest.value.toString()})`);
    console.log(`  ts:     ${vault.lastManagerWithdrawRequest.ts.toString()}`);

    console.log(`minDepositAmount:  ${vault.minDepositAmount.toString()}`);
    console.log(`profitShare:       ${vault.profitShare}`);
    console.log(`hurdleRate:        ${vault.hurdleRate}`);
    console.log(`spotMarketIndex:   ${vault.spotMarketIndex}`);
    console.log(`permissioned:      ${vault.permissioned}`);

    const vaultEquityNum = convertToNumber(vaultEquity, QUOTE_PRECISION);
    const netDepositsNum = convertToNumber(vault.netDeposits, spotPrecision);
    console.log(`vaultEquity (USDC):   $${vaultEquityNum}`);
    console.log(`manager share (USDC): $${managerSharePct * vaultEquityNum}`);

    const vaultEquitySpot = vaultEquityNum / oraclePriceNum;

    const user = new User({
        // accountSubscription,
        driftClient,
        userAccountPublicKey: vault.user,
    });
    await user.subscribe();

    for (const spotPos of user.getActiveSpotPositions()) {
        const sm = driftClient.getSpotMarketAccount(spotPos.marketIndex)!;
        const prec = TEN.pow(new BN(sm.decimals));
        const sym = decodeName(sm.name);
        const bal = getSignedTokenAmount(getTokenAmount(spotPos.scaledBalance, sm, spotPos.balanceType), spotPos.balanceType);
        console.log(`Spot Position: ${spotPos.marketIndex}, ${convertToNumber(bal, prec)} ${sym}`);
    }

    for (const perpPos of user.getActivePerpPositions()) {
        console.log(`Perp Position: ${perpPos.marketIndex}, base: ${convertToNumber(perpPos.baseAssetAmount, BASE_PRECISION)}, quote: ${convertToNumber(perpPos.quoteAssetAmount, QUOTE_PRECISION)}`);
        const upnl = user.getUnrealizedPNL(true, perpPos.marketIndex);
        console.log(`  upnl: ${convertToNumber(upnl, QUOTE_PRECISION)}`);
    }

    console.log(`vaultEquity (${spotSymbol}):   ${vaultEquitySpot}`);
    console.log(`manager share (${spotSymbol}): ${managerSharePct * vaultEquitySpot}`);
    console.log(`vault PnL     (${spotSymbol}):   ${vaultEquitySpot - netDepositsNum}`);
    console.log(`vault PnL (USD) ${convertToNumber(user.getTotalAllTimePnl(), QUOTE_PRECISION)}`);
    console.log(`vault PnL (spot) ${convertToNumber(user.getTotalAllTimePnl(), QUOTE_PRECISION) / oraclePriceNum}`);

    return {
        managerShares,
        managerSharePct,
    };
}

export function printVaultDepositor(vaultDepositor: VaultDepositor) {
    console.log(`vault:          ${vaultDepositor.vault.toBase58()}`);
    console.log(`pubkey:         ${vaultDepositor.pubkey.toBase58()}`);
    console.log(`authority:      ${vaultDepositor.authority.toBase58()}`);
    console.log(`vaultShares:    ${vaultDepositor.vaultShares.toString()}`);
    console.log(`lastWithdrawRequest.Shares:   ${vaultDepositor.lastWithdrawRequest.shares.toString()}`);
    console.log(`lastWithdrawRequest.Value:    ${vaultDepositor.lastWithdrawRequest.value.toString()}`);
    console.log(`lastWithdrawRequest.Ts:       ${vaultDepositor.lastWithdrawRequest.ts.toString()}`);
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
            console.log(opts.keypair);
            keypair = loadKeypair(opts.keypair as string);
        } catch (e) {
            console.error(`Need to provide a valid keypair: ${e}`);
            process.exit(1);
        }
    } else {
        keypair = Keypair.generate();
    }

    const wallet = new Wallet(keypair);
    if (needToSign) {
        console.log(`Signing wallet address: `, wallet.publicKey.toBase58());
    }

    const connection = new Connection(opts.url, {
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
        txSender: new WhileValidTxSender({
            connection,
            wallet,
            opts: {
                maxRetries: 0,
            },
            retrySleep: 1000,
        }),
    });
    await driftClient.subscribe();

    const provider = new AnchorProvider(connection, wallet, {});
    anchor.setProvider(provider);
    const vaultProgramId = VAULT_PROGRAM_ID;
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