# Drift Vaults

soon^TM

[did you see the CLI?](./ts/sdk/README.md) and the [wiki?](https://github.com/drift-labs/drift-vaults/wiki)

# Development

* anchor 1.0.0
* rust 1.91.1
* solana / agave 2.3.11

```shell
# if you don't have avm, install it here:
# https://book.anchor-lang.com/getting_started/installation.html
avm use 1.0.0

# if on Apple Silicon:
# rustup override set 1.91.1-x86_64-apple-darwin
# else
rustup override set 1.91.1

# if you already have solana/agave:
# agave-install init 2.3.11
# else:
sh -c "$(curl -sSfL https://release.anza.xyz/v2.3.11/install)"
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

# can be any valid key
ANCHOR_WALLET=~/.config/solana/id.json && anchor test
```

For ease-of-use you can run the following script to build and test instead:

```shell
chmod +x ./test.sh
./test.sh
```
