# CLI Usage

This repo has a simple CLI for interacting with the vault (run from this `package.json`):

This CLI utility requires an RPC node and keypair to sign transactions (similar to solana cli). You can either provide these as environment variables or in a `.env` file, or use the `--keypair` and `--url` flags.

Required Environment Variables or Flags:

Environment Variable| command line flag | Description
--------------------|-------------------|------------
RPC_URL             | --url             | The RPC node to connect to for transactions
KEYPAIR_PATH        | --keypair         | Path to keypair to sign transactions


View available commands, run with `--help` in nested commands to get available options for each command
```
yarn cli --help
```


Init a new vault. This will initialize a new vault and update you (the manager) as the delegate, unless `--delegate` is specified.
```
$ yarn cli init-vault --help
Usage: cli init-vault [options]

Initialize a new vault

Options:
  -n, --name <string>               Name of the vault to create
  -i, --market-index <number>       Spot market index to accept for deposits (default 0 == USDC) (default: "0")
  -r, --redeem-period <number>      The period (in seconds) depositors must wait after requesting a withdraw (default: 7 days) (default: "604800")
  -x, --max-tokens <number>         The max number of spot marketIndex tokens the vault can accept (default 0 == unlimited) (default: "0")
  -m, --management-fee <percent>    The annualized management fee to charge depositors (default: "0")
  -s, --profit-share <percent>      The percentage of profits charged by manager (default: "0")
  -p, --permissioned                Provide this flag to make the vault permissioned, vault-depositors will need to be initialized by the manager
                                    (default: false)
  -a, --min-deposit-amount <number  The minimum token amount allowed to deposit (default: "0")
  -d, --delegate <publicKey>        The address to make the delegate of the vault
  -h, --help                        display help for command
```

To update params in a vault:
```
$ yarn cli manager-update-vault --help
Usage: cli manager-update-vault [options]

Update vault params for a manager

Options:
  --vault-address <address>         Address of the vault to update
  -r, --redeem-period <number>      The new redeem period (can only be lowered)
  -x, --max-tokens <number>         The max tokens the vault can accept
  -a, --min-deposit-amount <number  The minimum token amount allowed to deposit
  -m, --management-fee <percent>    The new management fee (can only be lowered)
  -s, --profit-share <percent>      The new profit share percentage (can only be lowered)
  -p, --permissioned <boolean>      Set the vault as permissioned (true) or open (false) (default: false)
  -h, --help                        display help for command
```

Make a deposit into a vault (as a manager, `DEPOSIT_AMOUNT` in human precision):
```
yarn cli manager-deposit --vault-address=<VAULT_ADDRESS> --amount=<DEPOSIT_AMOUNT>
```

Make a withdraw request from a vault (as a manager, `SHARES` in raw precision):
```
yarn cli manager-request-withdraw --vault-address=<VAULT_ADDRESS> --amount=<SHARES>
```

Manager can trigger a profit share calculation (this looks up all `VaultDepositors` for a vault eligible for profit share and batch processes them):
```
yarn cli apply-profit-share-all --vault-address=<VAULT_ADDRESS>
```


For permissioned vaults, initialize a `VaultDepositor` for someone to deposit.
```
yarn cli init-vault-depositor --vault-address=<VAULT_ADDRESS> --deposit-authority=<AUTHORITY_TO_ALLOW_DEPOSIT>
```
Then send them the `VAULT_DEPOSITOR_ADDRESS`


Make a deposit into a vault (as a non-manager, `DEPOSIT_AMOUNT` in human precision):
```
yarn cli deposit --vault-depositor-address=<VAULT_DEPOSITOR_ADDRESS> --amount=<DEPOSIT_AMOUNT>
```


To print out the current state of a `Vault` or `VaultDepositor`:
```
yarn cli view-vault --vault-address=<VAULT_ADDRESS>

yarn cli view-vault-depositor --vault-depositor-address=<VAULT_DEPOSITOR_ADDRESS>
```

