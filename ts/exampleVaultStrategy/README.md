# Example Vault Strategy

This is an example of a trading strategy that trades the funds in a vault.

## Prerequisites
1) initialize a vault on chain
    * see the [wiki](https://github.com/drift-labs/drift-vaults/wiki/Initialize-A-Vault)
    * and [cli README](../sdk/cli/README.md)
2) get your vault address, there are multiple ways:
    * `yarn cli derive-vault-address --vault-name="your vault name"`
    * note it down during initialization
    * [streamlit](https://driftv2.herokuapp.com/?tab=Vaults)
3) the private key to the address listed as the __delegate__ of the vault
    * by default this is the authority who initialized the vault
    * it can be changed with `yarn cli manager-update-delegate`

## Explanation

### How the account permissions work

Accounts on drift can have a __delegate__. The vault has a drift account, and is able to assign a delegate to it. The delegate is able to sign transactions on behalf of the vault. This is how the strategy will be trading the vault funds.


### Strategy

Assumptions on the vault setup:
* vault has some redeem period, so depositors will not withdraw funds immediately
* the deposit token is spot marketIndex 0 (USDC)
* only provides liquidity on SOL-PERP

This vault strategy is a simple market making strategy that quotes around the current oracle price with a 10 bps edge. It provides liquidity with 20% of the vault's available balance (less any pending withdraws).

### Usage

1) install dependencies
    ```
    git clone git@github.com:drift-labs/drift-vaults.git
    cd ts/exampleVaultStrategy
    yarn
    yarn install
    ```

2) set environment variables in a new .env file
    ```
    cp .env.example .env
    ```

3) run the strategy
    ```
    yarn run dev
    ```