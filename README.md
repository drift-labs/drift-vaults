# Drift Vaults

soon^TM

[did you see the CLI?](./ts/sdk/README.md) and the [wiki?](https://github.com/drift-labs/drift-vaults/wiki)

# Development

* anchor 0.29.0
* rust 1.70.0
* solana 1.16.27

### Prerequisites

<details>
<summary><b>Install from scratch (click to expand)</b></summary>

#### 1. Install Rust

```shell
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
source "$HOME/.cargo/env"
```

#### 2. Set Rust version

```shell
# if on Apple Silicon:
rustup override set 1.70.0-x86_64-apple-darwin
# else:
rustup override set 1.70.0
```

#### 3. Install Solana CLI

The legacy `release.solana.com` endpoint is no longer available. Install from the GitHub release binaries instead:

```shell
# Linux x86_64:
sh -c "$(curl -sSfL https://github.com/solana-labs/solana/releases/download/v1.16.27/install)"

# Or download the installer directly:
mkdir -p ~/.local/bin
wget https://github.com/solana-labs/solana/releases/download/v1.16.27/solana-install-init-x86_64-unknown-linux-gnu \
  -O ~/.local/bin/solana-install-init
chmod +x ~/.local/bin/solana-install-init
~/.local/bin/solana-install-init v1.16.27

# macOS (Apple Silicon):
curl -L https://github.com/solana-labs/solana/releases/download/v1.16.27/solana-release-aarch64-apple-darwin.tar.bz2 \
  | tar -xjf - -C ~/.local/share/
export PATH="$HOME/.local/share/solana-release/bin:$PATH"
```

#### 4. Install Anchor via AVM

```shell
# Install AVM (Anchor Version Manager)
# Docs: https://www.anchor-lang.com/docs/avm
cargo install --git https://github.com/coral-xyz/anchor avm --force
avm install 0.29.0
avm use 0.29.0
```

#### Verify versions

```shell
solana -V    # solana-cli 1.16.27
rustc -V     # rustc 1.70.0
anchor -V    # anchor-cli 0.29.0
```

</details>

<details>
<summary><b>Already have toolchains installed (click to expand)</b></summary>

```shell
rustup override set 1.70.0
# or on Apple Silicon: rustup override set 1.70.0-x86_64-apple-darwin

solana-install init 1.16.27

avm use 0.29.0
```

</details>

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
