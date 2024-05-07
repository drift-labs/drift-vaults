import * as anchor from '@coral-xyz/anchor';
import { AnchorProvider } from '@coral-xyz/anchor';
import { Program } from '@coral-xyz/anchor';

import {
    Keypair,
    Transaction,
    PublicKey,
    SystemProgram,
    sendAndConfirmTransaction,
    TransactionInstruction,
    Connection,
    SolanaJSONRPCError,
} from '@solana/web3.js';

import {
    createAssociatedTokenAccountInstruction,
    createMintToInstruction,
    getAssociatedTokenAddress,
    NATIVE_MINT,
} from '@solana/spl-token';

import {
    initializeQuoteSpotMarket,
    initializeSolSpotMarket,
    mockOracle,
    printTxLogs,
} from './testHelpers';
import {
    BN,
    TestClient,
    OracleSource,
    OracleInfo,
    BulkAccountLoader,
    castNumberToSpotPrecision,
    getLimitOrderParams,
    getTokenAmount,
    isVariant,
    PositionDirection,
    PRICE_PRECISION,
    SpotBalanceType,
    Wallet,
    BASE_PRECISION,
} from '@drift-labs/sdk';
import { TokenConfig } from '@ellipsis-labs/phoenix-sdk';
import * as Phoenix from '@ellipsis-labs/phoenix-sdk';
import { assert } from 'chai';
import { TOKEN_PROGRAM_ID } from '@coral-xyz/anchor/dist/cjs/utils/token';

// DO NOT USE THIS PRIVATE KEY IN PRODUCTION
// This key is the market authority as well as the market maker
const god = Keypair.fromSeed(
    new Uint8Array([
        65, 65, 65, 65, 65, 65, 65, 65, 65, 65, 65, 65, 65, 65, 65, 65, 65, 65, 65,
        65, 65, 65, 65, 65, 65, 65, 65, 65, 65, 65, 65, 65,
    ])
);
const phoenixMaker = Keypair.generate();

// Hardcoded market address of SOL/USDC Phoenix market
// This market is loaded at genesis
const solMarketAddress = new PublicKey(
    // 'HhHRvLFvZid6FD7C96H93F2MkASjYfYAx8Y2P8KMAr6b'
    '4DoNfFBfF7UokCC2FQzriy7yHK6DY6NVdYpuekQ5pRgg',
);
// let solMarket: Phoenix.MarketState;

const usdcMint = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');

const tokenConfig: TokenConfig[] = [
    {
        name: 'USD Coin',
        symbol: 'USDC',
        mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        logoUri:
            'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v/logo.png',
    },
    {
        name: 'Wrapped SOL',
        symbol: 'SOL',
        mint: 'So11111111111111111111111111111111111111112',
        logoUri:
            'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/So11111111111111111111111111111111111111112/logo.png',
    },
];

const createPhoenixClient = async (
    connection: Connection
): Promise<Phoenix.Client> => {
    const client = await Phoenix.Client.createWithoutConfig(connection, []);
    // client.tokenConfigs = tokenConfig;
    await client.addMarket(solMarketAddress.toBase58());
    return client;
};

const createTokenAccountInstructions = async (
    provider: AnchorProvider,
    tokenMintAddress: PublicKey,
    owner?: PublicKey
): Promise<[PublicKey, TransactionInstruction]> => {
    owner = owner || provider.wallet.publicKey;

    const userTokenAccount = await getAssociatedTokenAddress(
        tokenMintAddress,
        owner
    );

    const createAta = createAssociatedTokenAccountInstruction(
        provider.wallet.publicKey,
        userTokenAccount,
        owner,
        tokenMintAddress
    );

    return [userTokenAccount, createAta];
};

const createTokenAccountAndMintTokens = async (
    provider: AnchorProvider,
    tokenMintAddress: PublicKey,
    mintAmount: BN,
    mintAuthority: Keypair,
    owner?: PublicKey
): Promise<PublicKey> => {
    const tx = new Transaction();

    const [userTokenAccount, createAta] = await createTokenAccountInstructions(
        provider,
        tokenMintAddress,
        owner
    );

    tx.add(createAta);

    const mintToUserAccountTx = await createMintToInstruction(
        tokenMintAddress,
        userTokenAccount,
        mintAuthority.publicKey,
        mintAmount.toNumber()
    );
    tx.add(mintToUserAccountTx);

    await sendAndConfirmTransaction(
        provider.connection,
        tx,
        // @ts-ignore
        [provider.wallet.payer, mintAuthority],
        {
            skipPreflight: false,
            commitment: 'confirmed',
        }
    );

    return userTokenAccount;
};

const createWSOLAccount = async (
    provider: AnchorProvider,
    mintAmount?: BN,
    owner?: PublicKey
): Promise<PublicKey> => {
    const tx = new Transaction();
    const [userWSOLAccount, createAta] = await createTokenAccountInstructions(
        provider,
        NATIVE_MINT,
        owner
    );
    if (mintAmount.gtn(0)) {
        const transferIx = SystemProgram.transfer({
            fromPubkey: provider.wallet.publicKey,
            toPubkey: userWSOLAccount,
            lamports: mintAmount.toNumber(),
        });
        tx.add(transferIx);
    }
    tx.add(createAta);
    await sendAndConfirmTransaction(
        provider.connection,
        tx,
        // @ts-ignore
        [provider.wallet.payer],
        {
            skipPreflight: false,
            commitment: 'confirmed',
        }
    );
    return userWSOLAccount;
};

describe('Trade on Phoenix', () => {
    const provider = anchor.AnchorProvider.local(undefined, {
        commitment: 'confirmed',
        skipPreflight: false,
        preflightCommitment: 'confirmed',
    });
    const connection = provider.connection;
    anchor.setProvider(provider);

    let phoenixClient: Phoenix.Client;

    // 200 USDC
    const usdcAmount = new BN(200 * 10 ** 6);
    // 2 SOL
    const solAmount = new BN(2 * 10 ** 9);

    let marketIndexes: number[];
    let spotMarketIndexes: number[];

    before(async () => {

        phoenixClient = await createPhoenixClient(connection);

        await phoenixClient.refreshAllMarkets(false);
        let phoenixMarket = phoenixClient.marketStates.get(
            solMarketAddress.toBase58()
        );

        marketIndexes = [];
        spotMarketIndexes = [0, 1];

        // Top-up god key's SOL balance
        try {
            await sendAndConfirmTransaction(
                connection,
                new Transaction().add(
                    SystemProgram.transfer({
                        fromPubkey: provider.wallet.publicKey,
                        toPubkey: god.publicKey,
                        lamports: 10000000000000,
                    })
                ),
                // @ts-ignore
                [provider.wallet.payer],
                { commitment: 'confirmed' }
            );
        } catch (e) {
            console.error(e.logs);
            throw new Error(e);
        }

        try {
            await sendAndConfirmTransaction(
                connection,
                new Transaction().add(
                    SystemProgram.transfer({
                        fromPubkey: provider.wallet.publicKey,
                        toPubkey: phoenixMaker.publicKey,
                        lamports: 10000000000000,
                    })
                ),
                // @ts-ignore
                [provider.wallet.payer],
                { commitment: 'confirmed' }
            );
        } catch (e) {
            console.error(e.logs);
            throw new Error(e);
        }

        for (const account of [god, phoenixMaker]) {
            try {
                const usdcAddress = await createTokenAccountAndMintTokens(
                    provider,
                    usdcMint,
                    usdcAmount,
                    god,
                    account.publicKey
                );
                const usdcBalance = await connection.getTokenAccountBalance(usdcAddress);
                assert(usdcBalance.value.uiAmount > 0, `${account.publicKey.toBase58()} has ${usdcBalance.value.uiAmount} USDC, expected ${usdcAmount.toNumber()}`);

                const wSOLAddress = await createWSOLAccount(
                    provider,
                    solAmount,
                    account.publicKey
                );
                const wsolBalance = await connection.getTokenAccountBalance(wSOLAddress);
                assert(wsolBalance.value.uiAmount > 0, `${account.publicKey.toBase58()} has ${wsolBalance.value.uiAmount} wSOL, expected ${solAmount.toNumber()}`);
            } catch (e) {
                console.error(e.logs);
                throw new Error(e);
            }
        }


        for (const account of [god, phoenixMaker]) {
            const makerSetupIxs = await Phoenix.getMakerSetupInstructionsForMarket(connection, phoenixMarket, account.publicKey)
            console.log(`maker setup ixs: ${makerSetupIxs.length}`);
            if (makerSetupIxs.length > 0) {
                await sendAndConfirmTransaction(
                    connection,
                    new Transaction().add(...makerSetupIxs),
                    [account],
                    { commitment: 'confirmed' }
                )
            }
        }

        await phoenixClient.refreshAllMarkets(false);
        phoenixMarket = phoenixClient.marketStates.get(
            solMarketAddress.toBase58()
        );
        assert(phoenixMarket.data.traders.has(god.publicKey.toBase58()), `god is not a trader`);
        assert(phoenixMarket.data.traders.has(phoenixMaker.publicKey.toBase58()), `phoenixMaker is not a trader`);
    });

    after(async () => {
    });

    it('Test local setup can place orders', async () => {
        await phoenixClient.refreshAllMarkets(false);
        const phoenixMarketStart = phoenixClient.marketStates.get(
            solMarketAddress.toString()
        ).data;
        const bidsCountStart = phoenixMarketStart.bids.length;
        const asksCountStart = phoenixMarketStart.asks.length;

        const book = phoenixClient.getLadder(solMarketAddress.toString(), 2);

        const bestBidTicks = book.bids[0].priceInTicks;
        const bestAskTicks = book.asks[0].priceInTicks;
        const bestBid = phoenixClient.ticksToFloatPrice(bestBidTicks.toNumber(), solMarketAddress.toString());
        const bestAsk = phoenixClient.ticksToFloatPrice(bestAskTicks.toNumber(), solMarketAddress.toString());
        console.log(`bbo: ${bestBid}/${bestAsk}`)
        console.log(`bboTicks: ${bestBidTicks}/${bestAskTicks}`)

        // quote at bbo for each maker
        for (const acc of [god, phoenixMaker]) {
            const askOrderPacket = Phoenix.getPostOnlyOrderPacket({
                side: Phoenix.Side.Ask,
                priceInTicks: bestAskTicks.toNumber(),
                numBaseLots: phoenixClient.rawBaseUnitsToBaseLotsRoundedDown(
                    1.54,
                    solMarketAddress.toString()
                ),
            });

            const placeAskInstruction = phoenixClient.createPlaceLimitOrderInstruction(
                askOrderPacket,
                solMarketAddress.toString(),
                acc.publicKey
            );

            const bidOrderPacket = Phoenix.getPostOnlyOrderPacket({
                side: Phoenix.Side.Bid,
                priceInTicks: bestBidTicks.toNumber(),
                numBaseLots: phoenixClient.rawBaseUnitsToBaseLotsRoundedDown(
                    1.11,
                    solMarketAddress.toString()
                ),
            });

            const placeBidInstruction = phoenixClient.createPlaceLimitOrderInstruction(
                bidOrderPacket,
                solMarketAddress.toString(),
                acc.publicKey
            );

            try {
                const placeTxId = await sendAndConfirmTransaction(
                    connection,
                    new Transaction().add(placeAskInstruction, placeBidInstruction),
                    [acc],
                    { skipPreflight: false, commitment: 'confirmed' }
                );
                console.log(`${acc.publicKey.toBase58()} place order logs:`);
                await printTxLogs(connection, placeTxId);
            } catch (e) {
                console.log(e.logs);
                throw new Error(e);
            }
        }

        await phoenixClient.refreshAllMarkets(false);
        const phoenixMarketEnd = phoenixClient.marketStates.get(
            solMarketAddress.toString()
        ).data;
        const bidsCountAfter = phoenixMarketEnd.bids.length;
        const asksCountAfter = phoenixMarketEnd.asks.length;

        assert(asksCountAfter - asksCountStart === 2, 'Asks length didnt change');
        assert(bidsCountAfter - bidsCountStart === 2, 'Bids length didnt change');

        const l3Book = phoenixClient.getL3UiBook(
            solMarketAddress.toString()
        );
        const bidMakers = l3Book.bids.map(o => o.makerPubkey);
        const askMakers = l3Book.asks.map(o => o.makerPubkey);
        assert(bidMakers.includes(god.publicKey.toBase58()), 'God has no bids');
        assert(askMakers.includes(god.publicKey.toBase58()), 'God has no asks');
        assert(bidMakers.includes(phoenixMaker.publicKey.toBase58()), 'phoenixMaker has no bids');
        assert(askMakers.includes(phoenixMaker.publicKey.toBase58()), 'phoenixMaker has no asks');
    });
});
