import { DriftClient } from '@drift-labs/sdk';
import { Program } from '@coral-xyz/anchor';
import { DriftVaults } from './types/drift_vaults';
import { TransactionSignature } from '@solana/web3.js';
export declare class VaultClient {
    driftClient: DriftClient;
    program: Program<DriftVaults>;
    constructor({ driftClient, program, }: {
        driftClient: DriftClient;
        program: Program<DriftVaults>;
    });
    initializeVault(name: string): Promise<TransactionSignature>;
}
