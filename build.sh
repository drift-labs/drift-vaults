home() {
    cd "$(git rev-parse --show-toplevel)" || exit 1
}

# return root level of the git repo
home

if [[ $(uname -m) == "arm64" ]]; then
    echo "Running on Apple Silicon, using x86-64 toolchain"
    rustup override set 1.70.0-x86_64-apple-darwin
else
    rustup override set 1.70.0
fi

# check that "solana" returns output from the command line
solana_cli_exists=$(solana --version)
if [[ -z $solana_cli_exists ]]; then
    echo "Installing Solana CLI..."
    sh -c "$(curl -sSfL https://release.solana.com/v1.16.27/install)" || exit 1
fi

avm_cli_exists=$(avm --version)
if [[ -z $avm_cli_exists ]]; then
    echo "Please install Anchor here: https://book.anchor-lang.com/getting_started/installation.html"
    exit 1
fi

solana-install init 1.16.27

avm use 0.29.0

cargo build || exit 1

anchor build || exit 1

cargo fmt || exit 1

yarn && cd ts/sdk && yarn && yarn build || exit 1

home

yarn prettify:fix || exit 1