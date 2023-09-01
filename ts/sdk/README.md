# CLI Usage

This repo has a simple CLI for interacting with the vault (run from this `package.json`):

First create a `.env` and fill it out:
```
cp .env.example .env
```

View available commands, run with `--help` in nested commands to get available options for each command
```
yarn cli --help
```


Init a new vault. This will initialize a new vault and update you as the delegate.
Note that defaults are used for the vault (permissioned, 2% mgmt fee, 20% profit share), take
care to edit these as required.
```
yarn cli init-vault --name="super safe vault"
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
