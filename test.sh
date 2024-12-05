#!/usr/bin/env bash

detach=false
no_test=false
no_build=false

usage() {
  if [[ -n $1 ]]; then
    echo "$*"
    echo
  fi
  cat <<EOF

usage: $0 [OPTIONS]

OPTIONS:
  --detach             - Once bootstrap and tests are complete, keep the validator running
  --no-test            - Skip running tests and only bootstrap the validator
  --no-build           - Skip building the project

EOF
  exit 1
}

positional_args=()
while [[ -n $1 ]]; do
  if [[ ${1:0:1} = - ]]; then
    if [[ $1 = --detach ]]; then
      detach=true
      shift 1
    elif [[ $1 = --no-test ]]; then
      no_test=true
      shift 1
    elif [[ $1 = --no-build ]]; then
      no_build=true
      shift 1
    elif [[ $1 = -h ]]; then
      usage "$@"
    else
      echo "Unknown argument: $1"
      exit 1
    fi
  else
    positional_args+=("$1")
    shift
  fi
done

kill_process() {
    # Kills solana validator if running
    solana_pid=$(pgrep -f solana)
    if [[ -n $solana_pid ]]; then
        pkill -f solana
    fi
    # exit shell script with success status
    exit 0
}
# ctrl+c or similar signals are caught in this "trap" which will execute "kill_process" function
trap kill_process SIGINT

# helper function to silence output from whichever process proceeds this function
bkg() { "$@" >/dev/null & }

if [[ $no_build == false ]]; then
  chmod +x ./build.sh
  ./build.sh
fi

# Kill solana validator if running
solana_pid=$(pgrep -f solana)
if [[ -n $solana_pid ]]; then
  pkill -f solana
fi

# start anchor localnet in background
# "bkg" suppresses validator output to build/test output aren't hard to find
bkg anchor localnet
# warm up validator (spurious errors may occur if this is not done)
sleep 5

# if network bootstrap is required, such as admin-level instructions or minting tokens, then do that here.


export ANCHOR_WALLET="$HOME/.config/solana/id.json"
if [[ $no_test == false ]]; then
  yarn anchor-tests:test-no-shares
fi

# if --detach is not given, then the test is killed once "yarn anchor-tests" completes
# otherwise the validator continues to run
# passing --detach has the same effect as running "anchor test --detach"
if [[ $detach == false ]]; then
    kill_process
else
    echo "Validator still running..."
fi

# required for signal trap to work
while true; do
    sleep 1
done
