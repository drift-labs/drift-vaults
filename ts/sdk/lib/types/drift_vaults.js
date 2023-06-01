"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.IDL = void 0;
exports.IDL = {
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
            ],
            args: [
                {
                    name: 'name',
                    type: {
                        array: ['u8', 32],
                    },
                },
            ],
        },
    ],
    accounts: [
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
                        name: 'bump',
                        docs: ['The bump for the vault pda'],
                        type: 'u8',
                    },
                ],
            },
        },
    ],
};
