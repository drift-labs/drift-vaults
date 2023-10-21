import {
	AddressLookupTableAccount,
	ComputeBudgetProgram,
	Connection,
	PublicKey,
	TransactionInstruction,
} from '@solana/web3.js';
import * as anchor from '@coral-xyz/anchor';
import {
	BASE_PRECISION,
	BN,
	DriftClient,
	FastSingleTxSender,
	MarketType,
	PRICE_PRECISION,
	PositionDirection,
	PostOnlyParams,
	TEN,
	convertToNumber,
	getLimitOrderParams,
	getOrderParams,
} from '@drift-labs/sdk';

import { VAULT_PROGRAM_ID, Vault, VaultClient } from '../../sdk/src';
import { IDL } from '../../sdk/src/types/drift_vaults';

import { calculateAccountValueUsd, getWallet } from './utils';

import dotenv from 'dotenv';
dotenv.config();

const PERP_MARKET_TO_MM = 0; // SOL-PERP
const MM_EDGE_BPS = 10;
const BPS_BASE = 10000;
const PCT_ACCOUNT_VALUE_TO_QUOTE = 0.1; // quote 10% of account value per side
const SUFFICIENT_QUOTE_CHANGE_BPS = 2; // only requote if quote price changes by 2 bps

const stateCommitment = 'confirmed';

const delegatePrivateKey = process.env.DELEGATE_PRIVATE_KEY;
if (!delegatePrivateKey) {
	throw new Error('DELEGATE_PRIVATE_KEY not set');
}

const [_, delegateWallet] = getWallet(delegatePrivateKey);

const connection = new Connection(process.env.RPC_HTTP_URL!, {
	wsEndpoint: process.env.RPC_WS_URL,
	commitment: stateCommitment,
});
console.log(`Wallet: ${delegateWallet.publicKey.toBase58()}`);
console.log(`RPC endpoint: ${process.env.RPC_HTTP_URL}`);
console.log(`WS endpoint: ${process.env.RPC_WS_URL}`);

if (!process.env.RPC_HTTP_URL) {
	throw new Error('must set RPC_HTTP_URL not set');
}

const vaultAddressString = process.env.VAULT_ADDRESS;
if (!vaultAddressString) {
	throw new Error('must set VAULT_ADDRESS not set');
}
const vaultAddress = new PublicKey(vaultAddressString);

const driftClient = new DriftClient({
	connection,
	wallet: delegateWallet,
	env: 'mainnet-beta',
	opts: {
		commitment: stateCommitment,
		skipPreflight: false,
		preflightCommitment: stateCommitment,
	},
	authority: vaultAddress, // this is the vault's address with a drift account
	activeSubAccountId: 0, // vault should only have subaccount 0
	subAccountIds: [0],
	txSender: new FastSingleTxSender({
		connection,
		wallet: delegateWallet,
		opts: {
			commitment: stateCommitment,
			skipPreflight: false,
			preflightCommitment: stateCommitment,
		},
		timeout: 3000,
		blockhashRefreshInterval: 1000,
	}),
});
let driftLookupTableAccount: AddressLookupTableAccount | undefined;

const vaultProgramId = VAULT_PROGRAM_ID;
const vaultProgram = new anchor.Program(
	IDL,
	vaultProgramId,
	driftClient.provider
);
const driftVault = new VaultClient({
	driftClient: driftClient as any,
	program: vaultProgram as any,
	cliMode: false,
});
let vault: Vault | undefined;

async function updateVaultAccount() {
	// makes RPC request to fetch vault state
	vault = await driftVault.getVault(vaultAddress);
}

let lastBid: number | undefined;
let lastAsk: number | undefined;
function sufficientQuoteChange(newBid: number, newAsk: number): boolean {
	if (lastBid === undefined || lastAsk === undefined) {
		return true;
	}
	const bidDiff = newBid / lastBid - 1;
	const askDiff = newAsk / lastAsk - 1;

	if (
		Math.abs(bidDiff) > SUFFICIENT_QUOTE_CHANGE_BPS / BPS_BASE ||
		Math.abs(askDiff) > SUFFICIENT_QUOTE_CHANGE_BPS / BPS_BASE
	) {
		return true;
	}

	return false;
}

async function runMmLoop() {
	const user = driftClient.getUser();
	if (!vault) {
		console.log(`Vault has not been loaded yet`);
		return;
	}
	const usdcSpotMarket = driftClient.getSpotMarketAccount(0);
	if (!usdcSpotMarket) {
		throw new Error(`No spot market found for USDC`);
	}
	const usdcPrecision = TEN.pow(new BN(usdcSpotMarket.decimals));
	const vaultWithdrawalsRequested = convertToNumber(
		vault.totalWithdrawRequested,
		usdcPrecision
	);
	const currentAccountValue = calculateAccountValueUsd(user);
	const accessibleAccountValue =
		currentAccountValue - vaultWithdrawalsRequested;
	console.log(
		`Current vault equity: ${currentAccountValue}, withdrawals requested: ${vaultWithdrawalsRequested}`
	);

	const perpOracle = driftClient.getOracleDataForPerpMarket(PERP_MARKET_TO_MM);

	const oraclePriceNumber = convertToNumber(perpOracle.price, PRICE_PRECISION);
	const baseToQuote =
		(accessibleAccountValue * PCT_ACCOUNT_VALUE_TO_QUOTE) / oraclePriceNumber;

	const newBid = oraclePriceNumber * (1 - MM_EDGE_BPS / BPS_BASE);
	const newAsk = oraclePriceNumber * (1 + MM_EDGE_BPS / BPS_BASE);
	console.log(`New bid: ${newBid}, new ask: ${newAsk}`);

	// only requote on sufficient change
	if (!sufficientQuoteChange(newBid, newAsk)) {
		console.log(`Not re-quoting, insufficient change`);
		return;
	}

	// cancel orders and place new ones
	const ixs: Array<TransactionInstruction> = [];
	ixs.push(
		ComputeBudgetProgram.setComputeUnitLimit({
			units: 1_400_000,
		})
	);
	ixs.push(
		await driftClient.getCancelOrdersIx(
			MarketType.PERP,
			PERP_MARKET_TO_MM,
			null
		)
	);
	ixs.push(
		await driftClient.getPlaceOrdersIx([
			getOrderParams(
				getLimitOrderParams({
					marketType: MarketType.PERP,
					marketIndex: PERP_MARKET_TO_MM,
					direction: PositionDirection.LONG,
					baseAssetAmount: new BN(baseToQuote * BASE_PRECISION.toNumber()),
					price: new BN(newBid * PRICE_PRECISION.toNumber()),
					postOnly: PostOnlyParams.SLIDE, // will adjust crossing orders s.t. they don't cross
				})
			),
			getOrderParams(
				getLimitOrderParams({
					marketType: MarketType.PERP,
					marketIndex: PERP_MARKET_TO_MM,
					direction: PositionDirection.SHORT,
					baseAssetAmount: new BN(baseToQuote * BASE_PRECISION.toNumber()),
					price: new BN(newAsk * PRICE_PRECISION.toNumber()),
					postOnly: PostOnlyParams.SLIDE, // will adjust crossing orders s.t. they don't cross
				})
			),
		])
	);
	const txSig = await driftClient.txSender.sendVersionedTransaction(
		await driftClient.txSender.getVersionedTransaction(
			ixs,
			[driftLookupTableAccount!],
			[],
			driftClient.opts
		)
	);
	console.log(
		`Requoting ${baseToQuote} SOL, ${newBid} @ ${newAsk}, oracle: ${oraclePriceNumber}, tx: https://solscan.io/tx/${txSig.txSig}`
	);

	lastBid = newBid;
	lastAsk = newAsk;
}

async function main() {
	await driftClient.subscribe();
	driftLookupTableAccount = await driftClient.fetchMarketLookupTableAccount();
	await updateVaultAccount();

	console.log(`Starting Basic Vault Strategy`);
	console.log(` Vault: ${vaultAddress.toBase58()}`);
	console.log(` Trading as delegate: ${delegateWallet.publicKey.toBase58()}`);

	// run mm loop every 10s
	setInterval(runMmLoop, 10000);

	// update vault account in the background, it's less critical
	setInterval(updateVaultAccount, 60000);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
