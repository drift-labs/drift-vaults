import { BN, TEN } from '@drift-labs/sdk';

export const VAULT_SHARES_PRECISION_EXP = new BN(6);
export const FUEL_SHARE_PRECISION_EXP = new BN(18);
export const FUEL_SHARE_PRECISION = TEN.pow(FUEL_SHARE_PRECISION_EXP);
