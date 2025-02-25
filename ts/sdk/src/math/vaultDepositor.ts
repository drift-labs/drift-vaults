import {
	BN,
	PERCENTAGE_PRECISION,
	ZERO,
	unstakeSharesToAmount as depositSharesToVaultAmount,
	stakeAmountToShares as vaultAmountToDepositorShares,
	FuelOverflowAccount,
	UserStatsAccount,
	FuelOverflowStatus,
} from '@drift-labs/sdk';
import {
	FuelDistributionMode,
	Vault,
	VaultDepositor,
	VaultProtocol,
} from '../types/types';
import { FUEL_SHARE_PRECISION, MAGIC_FUEL_START_TS } from '../constants';

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
	vault: Vault,
	vaultProtocol?: VaultProtocol
) {
	const profit = totalAmount.sub(
		vaultDepositor.netDeposits.add(vaultDepositor.cumulativeProfitShareAmount)
	);
	let profitShare = vault.profitShare;
	if (vaultProtocol) {
		profitShare += vaultProtocol.protocolProfitShare;
	}
	if (profit.gt(ZERO)) {
		const profitShareAmount = profit
			.mul(new BN(profitShare))
			.div(PERCENTAGE_PRECISION);
		return profitShareAmount;
	}
	return ZERO;
}

/**
 * Calculates the equity across deposits and realized profit for a vaultDepositor
 * @param vaultDepositor vault depositor account
 * @param vaultEquity total vault equity
 * @param vault vault account
 * @param vaultProtocol if vault account has "vaultProtocol" then this is needed
 * @returns
 */
export function calculateRealizedVaultDepositorEquity(
	vaultDepositor: VaultDepositor,
	vaultEquity: BN,
	vault: Vault,
	vaultProtocol?: VaultProtocol
): BN {
	const vdAmount = depositSharesToVaultAmount(
		vaultDepositor.vaultShares,
		vault.totalShares,
		vaultEquity
	);
	const profitShareAmount = calculateProfitShare(
		vaultDepositor,
		vdAmount,
		vault,
		vaultProtocol
	);
	return vdAmount.sub(profitShareAmount);
}

export function calculateVaultUnsettledFuelPerShare(
	vault: Vault,
	vaultUserStats: UserStatsAccount,
	fuelOverflow?: FuelOverflowAccount
): BN {
	if (
		(vaultUserStats.fuelOverflowStatus & FuelOverflowStatus.Exists) === 1 &&
		!fuelOverflow
	) {
		throw new Error(
			'UserStats requires a FuelOverflow account to calculate total fuel'
		);
	}
	const userStatsTotalFuel = new BN(vaultUserStats.fuelInsurance)
		.add(new BN(vaultUserStats.fuelDeposits))
		.add(new BN(vaultUserStats.fuelBorrows))
		.add(new BN(vaultUserStats.fuelPositions))
		.add(new BN(vaultUserStats.fuelTaker))
		.add(new BN(vaultUserStats.fuelMaker));
	const overflowFuel = fuelOverflow
		? new BN(fuelOverflow.fuelInsurance)
				.add(fuelOverflow.fuelDeposits)
				.add(fuelOverflow.fuelBorrows)
				.add(fuelOverflow.fuelPositions)
				.add(fuelOverflow.fuelTaker)
				.add(fuelOverflow.fuelMaker)
		: ZERO;
	const totalFuel = userStatsTotalFuel.add(overflowFuel);

	if (totalFuel > vault.cumulativeFuel) {
		let shareDenominator = vault.userShares;
		if (vault.fuelDistributionMode === FuelDistributionMode.UsersOnly) {
			if (vault.userShares.eq(ZERO)) {
				shareDenominator = vault.totalShares;
			} else {
				shareDenominator = vault.userShares;
			}
		} else if (
			vault.fuelDistributionMode === FuelDistributionMode.UsersAndManager
		) {
			shareDenominator = vault.totalShares;
		}

		if (shareDenominator.gt(ZERO)) {
			const fuelDelta = totalFuel.sub(vault.cumulativeFuel);
			const fuelDeltaPerShare = fuelDelta
				.mul(FUEL_SHARE_PRECISION)
				.div(shareDenominator);

			return vault.cumulativeFuelPerShare.add(fuelDeltaPerShare);
		}
	}

	return vault.cumulativeFuelPerShare;
}

export function calculateVaultDepositorUnsettledFuel(
	vaultDepositor: VaultDepositor,
	vault: Vault,
	vaultUserStats: UserStatsAccount,
	fuelOverflow?: FuelOverflowAccount
): BN {
	// If timestamp hasn't changed, no new fuel to calculate
	if (Date.now() / 1000 <= vaultDepositor.lastFuelUpdateTs) {
		return vaultDepositor.fuelAmount;
	}

	// Special case for initial fuel setup
	if (vaultDepositor.lastFuelUpdateTs === MAGIC_FUEL_START_TS) {
		return vaultDepositor.fuelAmount;
	}

	const cumulativeFuelPerShare = calculateVaultUnsettledFuelPerShare(
		vault,
		vaultUserStats,
		fuelOverflow
	);

	// If vault's cumulative fuel per share is less than depositor's recorded amount,
	// this means the vault's fuel was reset - no new fuel to add
	if (cumulativeFuelPerShare.lt(vaultDepositor.cumulativeFuelPerShareAmount)) {
		return vaultDepositor.fuelAmount;
	}

	// Calculate new fuel
	const fuelPerShareDelta = cumulativeFuelPerShare.sub(
		vaultDepositor.cumulativeFuelPerShareAmount
	);
	const newFuel = fuelPerShareDelta
		.mul(vaultDepositor.vaultShares)
		.div(FUEL_SHARE_PRECISION);

	return vaultDepositor.fuelAmount.add(newFuel);
}

export function calculateVaultDepositorFuel(
	vaultDepositor: VaultDepositor,
	vault: Vault,
	vaultUserStats: UserStatsAccount,
	fuelOverflow?: FuelOverflowAccount
): BN {
	const vdFuel = vaultDepositor.fuelAmount;
	const unsettledFuel = calculateVaultDepositorUnsettledFuel(
		vaultDepositor,
		vault,
		vaultUserStats,
		fuelOverflow
	);

	return vdFuel.add(unsettledFuel);
}
