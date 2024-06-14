# Drift Vaults

soon^TM


[did you see the CLI?](./ts/sdk/README.md) and the [wiki?](https://github.com/drift-labs/drift-vaults/wiki)


# Development

* anchor 0.29.0
* rust 1.70.0
* solana 1.16.27

```
avm use 0.29.0
rustup default 1.70.0
sh -c "$(curl -sSfL https://release.solana.com/v1.16.27/install)"
```

* `gcc-12` (https://solana.stackexchange.com/a/6989)
```
brew install gcc@12

# update CPATH
sudo echo 'export CPATH="/Library/Developer/CommandLineTools/SDKs/MacOSX.sdk/usr/include"' >> ~/.zshrc
```

## Run tests
```
cd ts/sdk
yarn
yarn build

cd ..
export ANCHOR_WALLET=~/.config/solana/id.json
anchor test
```
