# Drift Vaults

soon^TM


[did you see the CLI?](./ts/sdk/README.md) and the [wiki?](https://github.com/drift-labs/drift-vaults/wiki)


# Development

Developed using Anchor 0.26.0:
```
avm use 0.26.0
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