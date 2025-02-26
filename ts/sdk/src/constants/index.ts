import { BN, TEN } from '@drift-labs/sdk';

export const VAULT_SHARES_PRECISION_EXP = new BN(6);

// arbitrarily large fuel per share precision
export const FUEL_SHARE_PRECISION_EXP = new BN(18);
export const FUEL_SHARE_PRECISION = TEN.pow(FUEL_SHARE_PRECISION_EXP);

// some arbitrary timestamp to identify VaultDepositors created after fuel distribution started.
export const MAGIC_FUEL_START_TS = 123;
