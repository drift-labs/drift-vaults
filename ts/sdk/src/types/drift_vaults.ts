export type DriftVaults = {
	version: '0.1.0';
	name: 'drift_vaults';
	instructions: [
		{
			name: 'initializeVault';
			accounts: [
				{
					name: 'vault';
					isMut: true;
					isSigner: false;
				},
				{
					name: 'tokenAccount';
					isMut: true;
					isSigner: false;
				},
				{
					name: 'driftUserStats';
					isMut: true;
					isSigner: false;
				},
				{
					name: 'driftUser';
					isMut: true;
					isSigner: false;
				},
				{
					name: 'driftState';
					isMut: true;
					isSigner: false;
				},
				{
					name: 'driftSpotMarket';
					isMut: false;
					isSigner: false;
				},
				{
					name: 'driftSpotMarketMint';
					isMut: false;
					isSigner: false;
				},
				{
					name: 'authority';
					isMut: false;
					isSigner: true;
				},
				{
					name: 'payer';
					isMut: true;
					isSigner: true;
				},
				{
					name: 'rent';
					isMut: false;
					isSigner: false;
				},
				{
					name: 'systemProgram';
					isMut: false;
					isSigner: false;
				},
				{
					name: 'driftProgram';
					isMut: false;
					isSigner: false;
				},
				{
					name: 'tokenProgram';
					isMut: false;
					isSigner: false;
				}
			];
			args: [
				{
					name: 'name';
					type: {
						array: ['u8', 32];
					};
				},
				{
					name: 'spotMarketIndex';
					type: 'u16';
				}
			];
		},
		{
			name: 'updateDelegate';
			accounts: [
				{
					name: 'vault';
					isMut: true;
					isSigner: false;
				},
				{
					name: 'authority';
					isMut: false;
					isSigner: true;
				},
				{
					name: 'driftUser';
					isMut: true;
					isSigner: false;
				},
				{
					name: 'driftProgram';
					isMut: false;
					isSigner: false;
				}
			];
			args: [
				{
					name: 'delegate';
					type: 'publicKey';
				}
			];
		},
		{
			name: 'initializeVaultDepositor';
			accounts: [
				{
					name: 'vault';
					isMut: false;
					isSigner: false;
				},
				{
					name: 'vaultDepositor';
					isMut: true;
					isSigner: false;
				},
				{
					name: 'authority';
					isMut: false;
					isSigner: true;
				},
				{
					name: 'payer';
					isMut: true;
					isSigner: true;
				},
				{
					name: 'rent';
					isMut: false;
					isSigner: false;
				},
				{
					name: 'systemProgram';
					isMut: false;
					isSigner: false;
				}
			];
			args: [];
		},
		{
			name: 'deposit';
			accounts: [
				{
					name: 'vault';
					isMut: true;
					isSigner: false;
				},
				{
					name: 'vaultDepositor';
					isMut: true;
					isSigner: false;
				},
				{
					name: 'authority';
					isMut: false;
					isSigner: true;
				},
				{
					name: 'vaultTokenAccount';
					isMut: true;
					isSigner: false;
				},
				{
					name: 'driftUserStats';
					isMut: true;
					isSigner: false;
				},
				{
					name: 'driftUser';
					isMut: true;
					isSigner: false;
				},
				{
					name: 'driftState';
					isMut: false;
					isSigner: false;
				},
				{
					name: 'driftSpotMarketVault';
					isMut: true;
					isSigner: false;
				},
				{
					name: 'userTokenAccount';
					isMut: true;
					isSigner: false;
				},
				{
					name: 'driftProgram';
					isMut: false;
					isSigner: false;
				},
				{
					name: 'tokenProgram';
					isMut: false;
					isSigner: false;
				}
			];
			args: [
				{
					name: 'amount';
					type: 'u64';
				}
			];
		},
		{
			name: 'requestWithdraw';
			accounts: [
				{
					name: 'vault';
					isMut: true;
					isSigner: false;
				},
				{
					name: 'vaultDepositor';
					isMut: true;
					isSigner: false;
				},
				{
					name: 'authority';
					isMut: false;
					isSigner: true;
				},
				{
					name: 'driftUserStats';
					isMut: false;
					isSigner: false;
				},
				{
					name: 'driftUser';
					isMut: false;
					isSigner: false;
				},
				{
					name: 'driftState';
					isMut: false;
					isSigner: false;
				}
			];
			args: [
				{
					name: 'withdrawAmount';
					type: 'u64';
				},
				{
					name: 'withdrawUnit';
					type: {
						defined: 'WithdrawUnit';
					};
				}
			];
		},
		{
			name: 'cancelRequestWithdraw';
			accounts: [
				{
					name: 'vault';
					isMut: true;
					isSigner: false;
				},
				{
					name: 'vaultDepositor';
					isMut: true;
					isSigner: false;
				},
				{
					name: 'authority';
					isMut: false;
					isSigner: true;
				},
				{
					name: 'driftUserStats';
					isMut: false;
					isSigner: false;
				},
				{
					name: 'driftUser';
					isMut: false;
					isSigner: false;
				},
				{
					name: 'driftState';
					isMut: false;
					isSigner: false;
				}
			];
			args: [];
		},
		{
			name: 'withdraw';
			accounts: [
				{
					name: 'vault';
					isMut: true;
					isSigner: false;
				},
				{
					name: 'vaultDepositor';
					isMut: true;
					isSigner: false;
				},
				{
					name: 'authority';
					isMut: false;
					isSigner: true;
				},
				{
					name: 'vaultTokenAccount';
					isMut: true;
					isSigner: false;
				},
				{
					name: 'driftUserStats';
					isMut: true;
					isSigner: false;
				},
				{
					name: 'driftUser';
					isMut: true;
					isSigner: false;
				},
				{
					name: 'driftState';
					isMut: false;
					isSigner: false;
				},
				{
					name: 'driftSpotMarketVault';
					isMut: true;
					isSigner: false;
				},
				{
					name: 'driftSigner';
					isMut: false;
					isSigner: false;
				},
				{
					name: 'userTokenAccount';
					isMut: true;
					isSigner: false;
				},
				{
					name: 'driftProgram';
					isMut: false;
					isSigner: false;
				},
				{
					name: 'tokenProgram';
					isMut: false;
					isSigner: false;
				}
			];
			args: [];
		},
		{
			name: 'liquidate';
			accounts: [
				{
					name: 'vault';
					isMut: true;
					isSigner: false;
				},
				{
					name: 'vaultDepositor';
					isMut: true;
					isSigner: false;
				},
				{
					name: 'authority';
					isMut: false;
					isSigner: true;
				},
				{
					name: 'driftUserStats';
					isMut: true;
					isSigner: false;
				},
				{
					name: 'driftUser';
					isMut: true;
					isSigner: false;
				},
				{
					name: 'driftState';
					isMut: false;
					isSigner: false;
				},
				{
					name: 'driftProgram';
					isMut: false;
					isSigner: false;
				}
			];
			args: [];
		}
	];
	accounts: [
		{
			name: 'vaultDepositor';
			type: {
				kind: 'struct';
				fields: [
					{
						name: 'vault';
						docs: ['The vault deposited into'];
						type: 'publicKey';
					},
					{
						name: 'pubkey';
						docs: [
							"The vault depositor account's pubkey. It is a pda of vault and authority"
						];
						type: 'publicKey';
					},
					{
						name: 'authority';
						docs: [
							'The authority is the address w permission to deposit/withdraw'
						];
						type: 'publicKey';
					},
					{
						name: 'vaultShares';
						docs: [
							"share of vault owned by this depositor. vault_shares / vault.total_shares is depositor's ownership of vault_equity"
						];
						type: 'u128';
					},
					{
						name: 'lastWithdrawRequestShares';
						docs: ['requested vault shares for withdraw'];
						type: 'u128';
					},
					{
						name: 'lastWithdrawRequestValue';
						docs: [
							'requested value (in vault spot_market_index) of shares for withdraw'
						];
						type: 'u64';
					},
					{
						name: 'lastWithdrawRequestTs';
						docs: ['request ts of vault withdraw'];
						type: 'i64';
					},
					{
						name: 'lastValidTs';
						docs: ['creation ts of vault depositor'];
						type: 'i64';
					},
					{
						name: 'netDeposits';
						docs: ['lifetime net deposits of vault depositor for the vault'];
						type: 'i64';
					},
					{
						name: 'cumulativeProfitShareAmount';
						docs: [
							'the token amount of gains the vault depositor has paid performance fees on'
						];
						type: 'i64';
					},
					{
						name: 'vaultSharesBase';
						docs: ['the exponent for vault_shares decimal places'];
						type: 'u32';
					}
				];
			};
		},
		{
			name: 'vault';
			type: {
				kind: 'struct';
				fields: [
					{
						name: 'name';
						docs: [
							'The name of the vault. Vault pubkey is derived from this name.'
						];
						type: {
							array: ['u8', 32];
						};
					},
					{
						name: 'pubkey';
						docs: [
							"The vault's pubkey. It is a pda of name and also used as the authority for drift user"
						];
						type: 'publicKey';
					},
					{
						name: 'authority';
						docs: [
							'The authority of the vault who has ability to update vault params'
						];
						type: 'publicKey';
					},
					{
						name: 'tokenAccount';
						docs: [
							'The vaults token account. Used to receive tokens between deposits and withdrawals'
						];
						type: 'publicKey';
					},
					{
						name: 'userStats';
						docs: ['The drift user stats account for the vault'];
						type: 'publicKey';
					},
					{
						name: 'user';
						docs: ['The drift user account for the vault'];
						type: 'publicKey';
					},
					{
						name: 'delegate';
						docs: [
							'The vaults designated delegate for drift user account',
							'Can differ from actual user delegate if vault is in liquidation'
						];
						type: 'publicKey';
					},
					{
						name: 'liquidationDelegate';
						docs: ['The delegate handling liquidation for depositor'];
						type: 'publicKey';
					},
					{
						name: 'userShares';
						docs: [
							'the sum of all shares held by the users (vault depositors)'
						];
						type: 'u128';
					},
					{
						name: 'totalShares';
						docs: ['the sum of all shares (including vault authority)'];
						type: 'u128';
					},
					{
						name: 'liquidationStartTs';
						docs: ['When the liquidation start'];
						type: 'i64';
					},
					{
						name: 'redeemPeriod';
						docs: [
							'the period (in seconds) that a vault depositor must wait after requesting a withdraw to complete withdraw'
						];
						type: 'i64';
					},
					{
						name: 'sharesBase';
						docs: [
							'the base 10 exponent of the shares (given massive share inflation can occur at near zero vault equity)'
						];
						type: 'u32';
					},
					{
						name: 'profitShare';
						docs: [
							"percentage of gains for vault admin upon depositor's realize/withdraw: PERCENTAGE_PRECISION"
						];
						type: 'u32';
					},
					{
						name: 'hurdleRate';
						docs: [
							'vault admin only collect incentive fees during periods when returns are higher than this amount: PERCENTAGE_PRECISION'
						];
						type: 'u32';
					},
					{
						name: 'spotMarketIndex';
						docs: [
							'The spot market index the vault deposits into/withdraws from'
						];
						type: 'u16';
					},
					{
						name: 'bump';
						docs: ['The bump for the vault pda'];
						type: 'u8';
					},
					{
						name: 'padding';
						type: {
							array: ['u8', 1];
						};
					}
				];
			};
		}
	];
	types: [
		{
			name: 'VaultDepositorAction';
			type: {
				kind: 'enum';
				variants: [
					{
						name: 'Deposit';
					},
					{
						name: 'WithdrawRequest';
					},
					{
						name: 'CancelWithdrawRequest';
					},
					{
						name: 'Withdraw';
					}
				];
			};
		},
		{
			name: 'WithdrawUnit';
			type: {
				kind: 'enum';
				variants: [
					{
						name: 'Shares';
					},
					{
						name: 'Token';
					}
				];
			};
		}
	];
	events: [
		{
			name: 'VaultRecord';
			fields: [
				{
					name: 'ts';
					type: 'i64';
					index: false;
				},
				{
					name: 'spotMarketIndex';
					type: 'u16';
					index: false;
				},
				{
					name: 'vaultEquityBefore';
					type: 'u64';
					index: false;
				}
			];
		},
		{
			name: 'VaultDepositorRecord';
			fields: [
				{
					name: 'ts';
					type: 'i64';
					index: false;
				},
				{
					name: 'vault';
					type: 'publicKey';
					index: false;
				},
				{
					name: 'depositorAuthority';
					type: 'publicKey';
					index: false;
				},
				{
					name: 'action';
					type: {
						defined: 'VaultDepositorAction';
					};
					index: false;
				},
				{
					name: 'amount';
					type: 'u64';
					index: false;
				},
				{
					name: 'spotMarketIndex';
					type: 'u16';
					index: false;
				},
				{
					name: 'vaultSharesBefore';
					type: 'u128';
					index: false;
				},
				{
					name: 'vaultSharesAfter';
					type: 'u128';
					index: false;
				},
				{
					name: 'vaultEquityBefore';
					type: 'u64';
					index: false;
				},
				{
					name: 'userVaultSharesBefore';
					type: 'u128';
					index: false;
				},
				{
					name: 'totalVaultSharesBefore';
					type: 'u128';
					index: false;
				},
				{
					name: 'userVaultSharesAfter';
					type: 'u128';
					index: false;
				},
				{
					name: 'totalVaultSharesAfter';
					type: 'u128';
					index: false;
				},
				{
					name: 'profitShare';
					type: 'u64';
					index: false;
				},
				{
					name: 'managementFee';
					type: 'u64';
					index: false;
				}
			];
		}
	];
	errors: [
		{
			code: 6000;
			name: 'Default';
			msg: 'Default';
		},
		{
			code: 6001;
			name: 'InvalidVaultRebase';
			msg: 'InvalidVaultRebase';
		},
		{
			code: 6002;
			name: 'InvalidVaultSharesDetected';
			msg: 'InvalidVaultSharesDetected';
		},
		{
			code: 6003;
			name: 'CannotWithdrawBeforeRedeemPeriodEnd';
			msg: 'CannotWithdrawBeforeRedeemPeriodEnd';
		},
		{
			code: 6004;
			name: 'InvalidVaultWithdraw';
			msg: 'InvalidVaultWithdraw';
		},
		{
			code: 6005;
			name: 'InsufficientVaultShares';
			msg: 'InsufficientVaultShares';
		},
		{
			code: 6006;
			name: 'InvalidVaultWithdrawSize';
			msg: 'InvalidVaultWithdrawSize';
		},
		{
			code: 6007;
			name: 'InvalidVaultForNewDepositors';
			msg: 'InvalidVaultForNewDepositors';
		},
		{
			code: 6008;
			name: 'VaultWithdrawRequestInProgress';
			msg: 'VaultWithdrawRequestInProgress';
		},
		{
			code: 6009;
			name: 'InvalidVaultDepositorInitialization';
			msg: 'InvalidVaultDepositorInitialization';
		},
		{
			code: 6010;
			name: 'DelegateNotAvailableForLiquidation';
			msg: 'DelegateNotAvailableForLiquidation';
		},
		{
			code: 6011;
			name: 'InvalidEquityValue';
			msg: 'InvalidEquityValue';
		},
		{
			code: 6012;
			name: 'VaultInLiquidation';
			msg: 'VaultInLiquidation';
		},
		{
			code: 6013;
			name: 'DriftError';
			msg: 'DriftError';
		}
	];
};

export const IDL: DriftVaults = {
	version: '0.1.0',
	name: 'drift_vaults',
	instructions: [
		{
			name: 'initializeVault',
			accounts: [
				{
					name: 'vault',
					isMut: true,
					isSigner: false,
				},
				{
					name: 'tokenAccount',
					isMut: true,
					isSigner: false,
				},
				{
					name: 'driftUserStats',
					isMut: true,
					isSigner: false,
				},
				{
					name: 'driftUser',
					isMut: true,
					isSigner: false,
				},
				{
					name: 'driftState',
					isMut: true,
					isSigner: false,
				},
				{
					name: 'driftSpotMarket',
					isMut: false,
					isSigner: false,
				},
				{
					name: 'driftSpotMarketMint',
					isMut: false,
					isSigner: false,
				},
				{
					name: 'authority',
					isMut: false,
					isSigner: true,
				},
				{
					name: 'payer',
					isMut: true,
					isSigner: true,
				},
				{
					name: 'rent',
					isMut: false,
					isSigner: false,
				},
				{
					name: 'systemProgram',
					isMut: false,
					isSigner: false,
				},
				{
					name: 'driftProgram',
					isMut: false,
					isSigner: false,
				},
				{
					name: 'tokenProgram',
					isMut: false,
					isSigner: false,
				},
			],
			args: [
				{
					name: 'name',
					type: {
						array: ['u8', 32],
					},
				},
				{
					name: 'spotMarketIndex',
					type: 'u16',
				},
			],
		},
		{
			name: 'updateDelegate',
			accounts: [
				{
					name: 'vault',
					isMut: true,
					isSigner: false,
				},
				{
					name: 'authority',
					isMut: false,
					isSigner: true,
				},
				{
					name: 'driftUser',
					isMut: true,
					isSigner: false,
				},
				{
					name: 'driftProgram',
					isMut: false,
					isSigner: false,
				},
			],
			args: [
				{
					name: 'delegate',
					type: 'publicKey',
				},
			],
		},
		{
			name: 'initializeVaultDepositor',
			accounts: [
				{
					name: 'vault',
					isMut: false,
					isSigner: false,
				},
				{
					name: 'vaultDepositor',
					isMut: true,
					isSigner: false,
				},
				{
					name: 'authority',
					isMut: false,
					isSigner: true,
				},
				{
					name: 'payer',
					isMut: true,
					isSigner: true,
				},
				{
					name: 'rent',
					isMut: false,
					isSigner: false,
				},
				{
					name: 'systemProgram',
					isMut: false,
					isSigner: false,
				},
			],
			args: [],
		},
		{
			name: 'deposit',
			accounts: [
				{
					name: 'vault',
					isMut: true,
					isSigner: false,
				},
				{
					name: 'vaultDepositor',
					isMut: true,
					isSigner: false,
				},
				{
					name: 'authority',
					isMut: false,
					isSigner: true,
				},
				{
					name: 'vaultTokenAccount',
					isMut: true,
					isSigner: false,
				},
				{
					name: 'driftUserStats',
					isMut: true,
					isSigner: false,
				},
				{
					name: 'driftUser',
					isMut: true,
					isSigner: false,
				},
				{
					name: 'driftState',
					isMut: false,
					isSigner: false,
				},
				{
					name: 'driftSpotMarketVault',
					isMut: true,
					isSigner: false,
				},
				{
					name: 'userTokenAccount',
					isMut: true,
					isSigner: false,
				},
				{
					name: 'driftProgram',
					isMut: false,
					isSigner: false,
				},
				{
					name: 'tokenProgram',
					isMut: false,
					isSigner: false,
				},
			],
			args: [
				{
					name: 'amount',
					type: 'u64',
				},
			],
		},
		{
			name: 'requestWithdraw',
			accounts: [
				{
					name: 'vault',
					isMut: true,
					isSigner: false,
				},
				{
					name: 'vaultDepositor',
					isMut: true,
					isSigner: false,
				},
				{
					name: 'authority',
					isMut: false,
					isSigner: true,
				},
				{
					name: 'driftUserStats',
					isMut: false,
					isSigner: false,
				},
				{
					name: 'driftUser',
					isMut: false,
					isSigner: false,
				},
				{
					name: 'driftState',
					isMut: false,
					isSigner: false,
				},
			],
			args: [
				{
					name: 'withdrawAmount',
					type: 'u64',
				},
				{
					name: 'withdrawUnit',
					type: {
						defined: 'WithdrawUnit',
					},
				},
			],
		},
		{
			name: 'cancelRequestWithdraw',
			accounts: [
				{
					name: 'vault',
					isMut: true,
					isSigner: false,
				},
				{
					name: 'vaultDepositor',
					isMut: true,
					isSigner: false,
				},
				{
					name: 'authority',
					isMut: false,
					isSigner: true,
				},
				{
					name: 'driftUserStats',
					isMut: false,
					isSigner: false,
				},
				{
					name: 'driftUser',
					isMut: false,
					isSigner: false,
				},
				{
					name: 'driftState',
					isMut: false,
					isSigner: false,
				},
			],
			args: [],
		},
		{
			name: 'withdraw',
			accounts: [
				{
					name: 'vault',
					isMut: true,
					isSigner: false,
				},
				{
					name: 'vaultDepositor',
					isMut: true,
					isSigner: false,
				},
				{
					name: 'authority',
					isMut: false,
					isSigner: true,
				},
				{
					name: 'vaultTokenAccount',
					isMut: true,
					isSigner: false,
				},
				{
					name: 'driftUserStats',
					isMut: true,
					isSigner: false,
				},
				{
					name: 'driftUser',
					isMut: true,
					isSigner: false,
				},
				{
					name: 'driftState',
					isMut: false,
					isSigner: false,
				},
				{
					name: 'driftSpotMarketVault',
					isMut: true,
					isSigner: false,
				},
				{
					name: 'driftSigner',
					isMut: false,
					isSigner: false,
				},
				{
					name: 'userTokenAccount',
					isMut: true,
					isSigner: false,
				},
				{
					name: 'driftProgram',
					isMut: false,
					isSigner: false,
				},
				{
					name: 'tokenProgram',
					isMut: false,
					isSigner: false,
				},
			],
			args: [],
		},
		{
			name: 'liquidate',
			accounts: [
				{
					name: 'vault',
					isMut: true,
					isSigner: false,
				},
				{
					name: 'vaultDepositor',
					isMut: true,
					isSigner: false,
				},
				{
					name: 'authority',
					isMut: false,
					isSigner: true,
				},
				{
					name: 'driftUserStats',
					isMut: true,
					isSigner: false,
				},
				{
					name: 'driftUser',
					isMut: true,
					isSigner: false,
				},
				{
					name: 'driftState',
					isMut: false,
					isSigner: false,
				},
				{
					name: 'driftProgram',
					isMut: false,
					isSigner: false,
				},
			],
			args: [],
		},
	],
	accounts: [
		{
			name: 'vaultDepositor',
			type: {
				kind: 'struct',
				fields: [
					{
						name: 'vault',
						docs: ['The vault deposited into'],
						type: 'publicKey',
					},
					{
						name: 'pubkey',
						docs: [
							"The vault depositor account's pubkey. It is a pda of vault and authority",
						],
						type: 'publicKey',
					},
					{
						name: 'authority',
						docs: [
							'The authority is the address w permission to deposit/withdraw',
						],
						type: 'publicKey',
					},
					{
						name: 'vaultShares',
						docs: [
							"share of vault owned by this depositor. vault_shares / vault.total_shares is depositor's ownership of vault_equity",
						],
						type: 'u128',
					},
					{
						name: 'lastWithdrawRequestShares',
						docs: ['requested vault shares for withdraw'],
						type: 'u128',
					},
					{
						name: 'lastWithdrawRequestValue',
						docs: [
							'requested value (in vault spot_market_index) of shares for withdraw',
						],
						type: 'u64',
					},
					{
						name: 'lastWithdrawRequestTs',
						docs: ['request ts of vault withdraw'],
						type: 'i64',
					},
					{
						name: 'lastValidTs',
						docs: ['creation ts of vault depositor'],
						type: 'i64',
					},
					{
						name: 'netDeposits',
						docs: ['lifetime net deposits of vault depositor for the vault'],
						type: 'i64',
					},
					{
						name: 'cumulativeProfitShareAmount',
						docs: [
							'the token amount of gains the vault depositor has paid performance fees on',
						],
						type: 'i64',
					},
					{
						name: 'vaultSharesBase',
						docs: ['the exponent for vault_shares decimal places'],
						type: 'u32',
					},
				],
			},
		},
		{
			name: 'vault',
			type: {
				kind: 'struct',
				fields: [
					{
						name: 'name',
						docs: [
							'The name of the vault. Vault pubkey is derived from this name.',
						],
						type: {
							array: ['u8', 32],
						},
					},
					{
						name: 'pubkey',
						docs: [
							"The vault's pubkey. It is a pda of name and also used as the authority for drift user",
						],
						type: 'publicKey',
					},
					{
						name: 'authority',
						docs: [
							'The authority of the vault who has ability to update vault params',
						],
						type: 'publicKey',
					},
					{
						name: 'tokenAccount',
						docs: [
							'The vaults token account. Used to receive tokens between deposits and withdrawals',
						],
						type: 'publicKey',
					},
					{
						name: 'userStats',
						docs: ['The drift user stats account for the vault'],
						type: 'publicKey',
					},
					{
						name: 'user',
						docs: ['The drift user account for the vault'],
						type: 'publicKey',
					},
					{
						name: 'delegate',
						docs: [
							'The vaults designated delegate for drift user account',
							'Can differ from actual user delegate if vault is in liquidation',
						],
						type: 'publicKey',
					},
					{
						name: 'liquidationDelegate',
						docs: ['The delegate handling liquidation for depositor'],
						type: 'publicKey',
					},
					{
						name: 'userShares',
						docs: [
							'the sum of all shares held by the users (vault depositors)',
						],
						type: 'u128',
					},
					{
						name: 'totalShares',
						docs: ['the sum of all shares (including vault authority)'],
						type: 'u128',
					},
					{
						name: 'liquidationStartTs',
						docs: ['When the liquidation start'],
						type: 'i64',
					},
					{
						name: 'redeemPeriod',
						docs: [
							'the period (in seconds) that a vault depositor must wait after requesting a withdraw to complete withdraw',
						],
						type: 'i64',
					},
					{
						name: 'sharesBase',
						docs: [
							'the base 10 exponent of the shares (given massive share inflation can occur at near zero vault equity)',
						],
						type: 'u32',
					},
					{
						name: 'profitShare',
						docs: [
							"percentage of gains for vault admin upon depositor's realize/withdraw: PERCENTAGE_PRECISION",
						],
						type: 'u32',
					},
					{
						name: 'hurdleRate',
						docs: [
							'vault admin only collect incentive fees during periods when returns are higher than this amount: PERCENTAGE_PRECISION',
						],
						type: 'u32',
					},
					{
						name: 'spotMarketIndex',
						docs: [
							'The spot market index the vault deposits into/withdraws from',
						],
						type: 'u16',
					},
					{
						name: 'bump',
						docs: ['The bump for the vault pda'],
						type: 'u8',
					},
					{
						name: 'padding',
						type: {
							array: ['u8', 1],
						},
					},
				],
			},
		},
	],
	types: [
		{
			name: 'VaultDepositorAction',
			type: {
				kind: 'enum',
				variants: [
					{
						name: 'Deposit',
					},
					{
						name: 'WithdrawRequest',
					},
					{
						name: 'CancelWithdrawRequest',
					},
					{
						name: 'Withdraw',
					},
				],
			},
		},
		{
			name: 'WithdrawUnit',
			type: {
				kind: 'enum',
				variants: [
					{
						name: 'Shares',
					},
					{
						name: 'Token',
					},
				],
			},
		},
	],
	events: [
		{
			name: 'VaultRecord',
			fields: [
				{
					name: 'ts',
					type: 'i64',
					index: false,
				},
				{
					name: 'spotMarketIndex',
					type: 'u16',
					index: false,
				},
				{
					name: 'vaultEquityBefore',
					type: 'u64',
					index: false,
				},
			],
		},
		{
			name: 'VaultDepositorRecord',
			fields: [
				{
					name: 'ts',
					type: 'i64',
					index: false,
				},
				{
					name: 'vault',
					type: 'publicKey',
					index: false,
				},
				{
					name: 'depositorAuthority',
					type: 'publicKey',
					index: false,
				},
				{
					name: 'action',
					type: {
						defined: 'VaultDepositorAction',
					},
					index: false,
				},
				{
					name: 'amount',
					type: 'u64',
					index: false,
				},
				{
					name: 'spotMarketIndex',
					type: 'u16',
					index: false,
				},
				{
					name: 'vaultSharesBefore',
					type: 'u128',
					index: false,
				},
				{
					name: 'vaultSharesAfter',
					type: 'u128',
					index: false,
				},
				{
					name: 'vaultEquityBefore',
					type: 'u64',
					index: false,
				},
				{
					name: 'userVaultSharesBefore',
					type: 'u128',
					index: false,
				},
				{
					name: 'totalVaultSharesBefore',
					type: 'u128',
					index: false,
				},
				{
					name: 'userVaultSharesAfter',
					type: 'u128',
					index: false,
				},
				{
					name: 'totalVaultSharesAfter',
					type: 'u128',
					index: false,
				},
				{
					name: 'profitShare',
					type: 'u64',
					index: false,
				},
				{
					name: 'managementFee',
					type: 'u64',
					index: false,
				},
			],
		},
	],
	errors: [
		{
			code: 6000,
			name: 'Default',
			msg: 'Default',
		},
		{
			code: 6001,
			name: 'InvalidVaultRebase',
			msg: 'InvalidVaultRebase',
		},
		{
			code: 6002,
			name: 'InvalidVaultSharesDetected',
			msg: 'InvalidVaultSharesDetected',
		},
		{
			code: 6003,
			name: 'CannotWithdrawBeforeRedeemPeriodEnd',
			msg: 'CannotWithdrawBeforeRedeemPeriodEnd',
		},
		{
			code: 6004,
			name: 'InvalidVaultWithdraw',
			msg: 'InvalidVaultWithdraw',
		},
		{
			code: 6005,
			name: 'InsufficientVaultShares',
			msg: 'InsufficientVaultShares',
		},
		{
			code: 6006,
			name: 'InvalidVaultWithdrawSize',
			msg: 'InvalidVaultWithdrawSize',
		},
		{
			code: 6007,
			name: 'InvalidVaultForNewDepositors',
			msg: 'InvalidVaultForNewDepositors',
		},
		{
			code: 6008,
			name: 'VaultWithdrawRequestInProgress',
			msg: 'VaultWithdrawRequestInProgress',
		},
		{
			code: 6009,
			name: 'InvalidVaultDepositorInitialization',
			msg: 'InvalidVaultDepositorInitialization',
		},
		{
			code: 6010,
			name: 'DelegateNotAvailableForLiquidation',
			msg: 'DelegateNotAvailableForLiquidation',
		},
		{
			code: 6011,
			name: 'InvalidEquityValue',
			msg: 'InvalidEquityValue',
		},
		{
			code: 6012,
			name: 'VaultInLiquidation',
			msg: 'VaultInLiquidation',
		},
		{
			code: 6013,
			name: 'DriftError',
			msg: 'DriftError',
		},
	],
};
