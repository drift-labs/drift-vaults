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
	errors: [
		{
			code: 6000;
			name: 'Default';
			msg: 'Default';
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
	errors: [
		{
			code: 6000,
			name: 'Default',
			msg: 'Default',
		},
	],
};
