#!/bin/zsh

VAULT_ADDRESSES=("GXyE3Snk3pPYX4Nz9QRVBrnBfbJRTAQYxuy5DRdnebAn" "F3no8aqNZRSkxvMEARC4feHJfvvrST2ZrHzr2NBVyJUr" "ACmnVY5gf1z9UGhzBgnr2bf3h2ZwXW2EDW1w8RC9cQk4" "5A1pDM2XVBKmuWFvgQx775ikFGL5P1q3gWKjiX91XC1L" "2xTTLUAR8QhenYfnGNpefnmAeyCXeK1G1mAkYwGXaPer" "C8NCUhqh668fH34PkJ4A6rmgaSkdfuJA8VaqkVyw8hYS")
#
#VAULT_ADDRESSES=("ACmnVY5gf1z9UGhzBgnr2bf3h2ZwXW2EDW1w8RC9cQk4")
#VAULT_ADDRESSES=("2xTTLUAR8QhenYfnGNpefnmAeyCXeK1G1mAkYwGXaPer")
#VAULT_ADDRESSES=("C8NCUhqh668fH34PkJ4A6rmgaSkdfuJA8VaqkVyw8hYS") # signal vault

for VAULT_ADDRESS in "${VAULT_ADDRESSES[@]}"
do
    echo "Running for vault $VAULT_ADDRESS"

    yarn cli view-vault --vault-address=$VAULT_ADDRESS
    #yarn cli check-invariants --vault-address=$VAULT_ADDRESS
    yarn cli apply-profit-share-all --vault-address=$VAULT_ADDRESS --threshold=1
    yarn cli view-vault --vault-address=$VAULT_ADDRESS
    echo ""
done


