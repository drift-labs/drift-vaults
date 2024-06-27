# Drift Vaults

soon^TM


[did you see the CLI?](./ts/sdk/README.md) and the [wiki?](https://github.com/drift-labs/drift-vaults/wiki)


# Development

* anchor 0.29.0
* rust 1.70.0
* solana 1.16.27

```shell
# if you don't have avm, install it here: 
# https://book.anchor-lang.com/getting_started/installation.html
avm use 0.29.0

# if on Apple Silicon:
# rustup override set 1.70.0-x86_64-apple-darwin
# else
rustup override set 1.70.0

# if you already have solana:
# solana-install init 1.16.27
# else:
sh -c "$(curl -sSfL https://release.solana.com/v1.16.27/install)"
```

If on Mac and getting this error: 
```shell
Error: failed to start validator: Failed to create ledger at test-ledger: blockstore error
```
then run these commands:
```shell
brew install gnu-tar
# Put this in ~/.zshrc 
export PATH="/opt/homebrew/opt/gnu-tar/libexec/gnubin:$PATH"
```

## Run tests
```shell
yarn && cd ts/sdk && yarn && yarn build && cd ..

export ANCHOR_WALLET=~/.config/solana/id.json && anchor test
```
