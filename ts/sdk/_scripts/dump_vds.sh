#!/bin/zsh

VAULT_ADDRESSES=("GXyE3Snk3pPYX4Nz9QRVBrnBfbJRTAQYxuy5DRdnebAn" "F3no8aqNZRSkxvMEARC4feHJfvvrST2ZrHzr2NBVyJUr" "ACmnVY5gf1z9UGhzBgnr2bf3h2ZwXW2EDW1w8RC9cQk4")

# jlp vaults
#VAULT_ADDRESSES=("5A1pDM2XVBKmuWFvgQx775ikFGL5P1q3gWKjiX91XC1L" "2xTTLUAR8QhenYfnGNpefnmAeyCXeK1G1mAkYwGXaPer")

for VAULT_ADDRESS in "${VAULT_ADDRESSES[@]}"
do
    FILE_NAME="${VAULT_ADDRESS}_depositors.txt"
    echo "Running for vault $VAULT_ADDRESS"
    yarn cli check-invariants --vault-address=$VAULT_ADDRESS > ${FILE_NAME}
    echo ""

    if [ -f "${FILE_NAME}" ]; then
        echo "File ${FILE_NAME} exists."
        SLOT=$(grep -o 'slot: [0-9]*' ${FILE_NAME} | awk '{print $2}')
        NEW_FILE_NAME="${SLOT}_${VAULT_ADDRESS}_depositors.txt"
        echo "Renaming ${FILE_NAME} -> ${NEW_FILE_NAME}"
        mv ${FILE_NAME} ${NEW_FILE_NAME}

        yarn cli view-vault --vault-address=$VAULT_ADDRESS | tee ${SLOT}_${VAULT_ADDRESS}_view.txt

    else
        echo "File ${VAULT_ADDRESS}_depositors.txt does not exist."
    fi
done


