home() {
    cd "$(git rev-parse --show-toplevel)" || exit 1
}

anchor_test=false
if [[ "$1" == "--anchor-test" ]]; then
    anchor_test=true
fi

# return root level of the git repo
home

if [[ $(uname -m) == "arm64" ]]; then
    echo "Running on Apple Silicon, using x86-64 toolchain"
    rustup override set 1.91.1-x86_64-apple-darwin
else
    rustup override set 1.91.1
fi

# check that "solana" returns output from the command line
solana_cli_exists=$(solana --version)
if [[ -z $solana_cli_exists ]]; then
    echo "Installing Agave CLI..."
    sh -c "$(curl -sSfL https://release.anza.xyz/v2.3.11/install)" || exit 1
fi

avm_cli_exists=$(avm --version)
if [[ -z $avm_cli_exists ]]; then
    echo "Please install Anchor here: https://www.anchor-lang.com/docs/installation"
    exit 1
fi

agave-install init 2.3.11 || solana-install init 2.3.11

avm use 1.0.0

cargo build || exit 1

if [[ "$anchor_test" == true ]]; then
    echo "Building with anchor-test"
    anchor build --ignore-keys -- --features anchor-test || exit 1
else
    echo "Building without anchor-test"
    anchor build --ignore-keys || exit 1
fi

cargo fmt || exit 1

yarn && cd ts/sdk && yarn && yarn build || exit 1

home

yarn prettify:fix || exit 1