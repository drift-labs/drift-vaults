import {
	BN,
	PERCENTAGE_PRECISION,
	ZERO,
	unstakeSharesToAmount as depositSharesToVaultAmount,
	stakeAmountToShares as vaultAmountToDepositorShares,
} from '@drift-labs/sdk';
import { Vault, VaultDepositor } from '../types/types';

/**
 * Calculates the unrealized profitShare for a vaultDepositor
 * @param vaultDepositor
 * @param vaultEquity
 * @param vault
 * @returns
 */
export function calculateApplyProfitShare(
	vaultDepositor: VaultDepositor,
	vaultEquity: BN,
	vault: Vault
): {
	profitShareAmount: BN;
	profitShareShares: BN;
} {
	const amount = depositSharesToVaultAmount(
		vaultDepositor.vaultShares,
		vault.totalShares,
		vaultEquity
	);
	const profitShareAmount = calculateProfitShare(vaultDepositor, amount, vault);
	const profitShareShares = vaultAmountToDepositorShares(
		profitShareAmount,
		vault.totalShares,
		vaultEquity
	);
	return {
		profitShareAmount,
		profitShareShares,
	};
}

export function calculateProfitShare(
	vaultDepositor: VaultDepositor,
	totalAmount: BN,
	vault: Vault
) {
	const profit = totalAmount.sub(
		vaultDepositor.netDeposits.add(vaultDepositor.cumulativeProfitShareAmount)
	);
	if (profit.gt(ZERO)) {
		const profitShareAmount = profit
			.mul(new BN(vault.profitShare))
			.div(PERCENTAGE_PRECISION);
		return profitShareAmount;
	}

	return ZERO;
}
