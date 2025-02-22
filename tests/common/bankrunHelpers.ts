import {
	BN,
	FuelOverflowStatus,
	getFuelOverflowAccountPublicKey,
	getUserStatsAccountPublicKey,
	PublicKey,
	TestClient,
	UserAccount,
	UserStatsAccount,
} from '@drift-labs/sdk';
import { AccountInfo } from '@solana/web3.js';
import { VaultClient, VaultDepositor, Vault } from '../../ts/sdk';
import { BankrunContextWrapper } from './bankrunConnection';

export async function overWriteUserStatsFuel(
	driftClient: TestClient,
	bankrunContextWrapper: BankrunContextWrapper,
	userStatsKey: PublicKey,
	fuelAmount: BN
) {
	const userStatsBefore = await getUserStatsDecoded(
		driftClient,
		bankrunContextWrapper,
		userStatsKey
	);
	userStatsBefore.data.fuelTaker = fuelAmount.toNumber();
	await overWriteUserStats(
		driftClient,
		bankrunContextWrapper,
		userStatsKey,
		userStatsBefore
	);
	await bankrunContextWrapper.moveTimeForward(1000);
}

export async function createVaultWithFuelOverflow(
	driftClient: TestClient,
	bankrunContextWrapper: BankrunContextWrapper,
	commonVaultKey: PublicKey,
	fuelAmount: BN = new BN(4_100_000_000)
) {
	const userStatsKey = getUserStatsAccountPublicKey(
		driftClient.program.programId,
		commonVaultKey
	);
	await overWriteUserStatsFuel(
		driftClient,
		bankrunContextWrapper,
		userStatsKey,
		fuelAmount
	);

	await driftClient.initializeFuelOverflow(commonVaultKey);
	await driftClient.sweepFuel(commonVaultKey);

	const userStatsAfterSweep = await driftClient.program.account.userStats.fetch(
		userStatsKey
	);
	expect(userStatsAfterSweep.fuelTaker).toBe(0);
	expect(
		userStatsAfterSweep.fuelOverflowStatus as number & FuelOverflowStatus.Exists
	).toBe(FuelOverflowStatus.Exists);

	const userFuelSweepAccount =
		await driftClient.program.account.fuelOverflow.fetch(
			getFuelOverflowAccountPublicKey(
				driftClient.program.programId,
				commonVaultKey
			)
		);
	expect(
		// @ts-ignore
		userFuelSweepAccount.authority.equals(commonVaultKey)
	).toBe(true);
	expect((userFuelSweepAccount.fuelTaker as BN).toNumber()).toBe(
		fuelAmount.toNumber()
	);
}

export async function getUserStatsDecoded(
	driftClient: TestClient,
	bankrunContextWrapper: BankrunContextWrapper,
	userStatsKey: PublicKey
): Promise<AccountInfo<UserStatsAccount>> {
	const accountInfo = await bankrunContextWrapper.connection.getAccountInfo(
		userStatsKey
	);
	const userStatsBefore: UserStatsAccount =
		driftClient.program.account.userStats.coder.accounts.decode(
			'UserStats',
			accountInfo!.data
		);

	// @ts-ignore
	accountInfo.data = userStatsBefore;
	// @ts-ignore
	return accountInfo;
}

export async function overWriteUserStats(
	driftClient: TestClient,
	bankrunContextWrapper: BankrunContextWrapper,
	userStatsKey: PublicKey,
	userStats: AccountInfo<UserStatsAccount>
) {
	bankrunContextWrapper.context.setAccount(userStatsKey, {
		executable: userStats.executable,
		owner: userStats.owner,
		lamports: userStats.lamports,
		data: await driftClient.program.account.userStats.coder.accounts.encode(
			'UserStats',
			userStats.data
		),
		rentEpoch: userStats.rentEpoch,
	});
}

export async function getVaultDepositorDecoded(
	vaultClient: VaultClient,
	bankrunContextWrapper: BankrunContextWrapper,
	vaultDepositorKey: PublicKey
): Promise<AccountInfo<VaultDepositor>> {
	const accountInfo = await bankrunContextWrapper.connection.getAccountInfo(vaultDepositorKey);
	const vaultDepositor = vaultClient.program.coder.accounts.decode('vaultDepositor', accountInfo!.data);

	// @ts-ignore
	accountInfo.data = vaultDepositor;
	// @ts-ignore
	return accountInfo;
}


export async function overWriteVaultDepositor(
	vaultClient: VaultClient,
	bankrunContextWrapper: BankrunContextWrapper,
	vaultDepositorKey: PublicKey,
	vaultDepositor: AccountInfo<VaultDepositor>
) {
	bankrunContextWrapper.context.setAccount(vaultDepositorKey, {
		executable: vaultDepositor.executable,
		owner: vaultDepositor.owner,
		lamports: vaultDepositor.lamports,
		data: await vaultClient.program.coder.accounts.encode(
			'vaultDepositor',
			vaultDepositor.data
		),
		rentEpoch: vaultDepositor.rentEpoch,
	});
}

export async function getVaultDecoded(
	vaultClient: VaultClient,
	bankrunContextWrapper: BankrunContextWrapper,
	vaultKey: PublicKey
): Promise<AccountInfo<Vault>> {
	const accountInfo = await bankrunContextWrapper.connection.getAccountInfo(vaultKey);
	const vault = vaultClient.program.coder.accounts.decode('vault', accountInfo!.data);

	// @ts-ignore
	accountInfo.data = vault;
	// @ts-ignore
	return accountInfo;
}


export async function overWriteVault(
	vaultClient: VaultClient,
	bankrunContextWrapper: BankrunContextWrapper,
	vaultKey: PublicKey,
	vault: AccountInfo<Vault>
) {
	bankrunContextWrapper.context.setAccount(vaultKey, {
		executable: vault.executable,
		owner: vault.owner,
		lamports: vault.lamports,
		data: await vaultClient.program.coder.accounts.encode(
			'vault',
			vault.data
		),
		rentEpoch: vault.rentEpoch,
	});
}


export async function getUserDecoded(
	driftClient: TestClient,
	bankrunContextWrapper: BankrunContextWrapper,
	userKey: PublicKey
): Promise<AccountInfo<UserAccount>> {
	const accountInfo = await bankrunContextWrapper.connection.getAccountInfo(
		userKey
	);
	const user: UserAccount =
		driftClient.program.account.user.coder.accounts.decodeUnchecked(
			'User',
			accountInfo!.data
		);

	// @ts-ignore
	accountInfo.data = user;
	// @ts-ignore
	return accountInfo;
}

export async function overWriteUser(
	driftClient: TestClient,
	bankrunContextWrapper: BankrunContextWrapper,
	userKey: PublicKey,
	user: AccountInfo<UserAccount>
) {
	bankrunContextWrapper.context.setAccount(userKey, {
		executable: user.executable,
		owner: user.owner,
		lamports: user.lamports,
		data: await driftClient.program.account.user.coder.accounts.encode(
			'User',
			user.data
		),
		rentEpoch: user.rentEpoch,
	});
}

export function readUnsignedBigInt64LE(buffer: Buffer, offset: number): BN {
	return new BN(buffer.subarray(offset, offset + 8), 10, 'le');
}

export async function overWriteUserSpotBalance(
	bankrunContextWrapper: BankrunContextWrapper,
	userPubkey: PublicKey,
	spotPositionIndex: number,
	newScaledBalance: BN
) {
	const user = await bankrunContextWrapper.connection.getAccountInfo(userPubkey);
	const userBuffer = Buffer.from(user!.data!);
	const spotPositionOffset = 40;
	const offset = 104 + spotPositionIndex * spotPositionOffset;
	// const scaledBalance = readUnsignedBigInt64LE(userBuffer, offset);
	userBuffer.writeBigUInt64LE(BigInt(newScaledBalance.toString()), offset);

	bankrunContextWrapper.context.setAccount(userPubkey, {
		executable: user!.executable,
		owner: user!.owner,
		lamports: user!.lamports,
		data: userBuffer,
		rentEpoch: user!.rentEpoch,
	});

}