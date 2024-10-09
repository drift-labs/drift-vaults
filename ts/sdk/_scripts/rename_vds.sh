
# ACmnVY5gf1z9UGhzBgnr2bf3h2ZwXW2EDW1w8RC9cQk4_depositors.txt
# F3no8aqNZRSkxvMEARC4feHJfvvrST2ZrHzr2NBVyJUr_depositors.txt
# GXyE3Snk3pPYX4Nz9QRVBrnBfbJRTAQYxuy5DRdnebAn_depositors.txt

VAULT_ADDRESSES=("GXyE3Snk3pPYX4Nz9QRVBrnBfbJRTAQYxuy5DRdnebAn" "F3no8aqNZRSkxvMEARC4feHJfvvrST2ZrHzr2NBVyJUr" "ACmnVY5gf1z9UGhzBgnr2bf3h2ZwXW2EDW1w8RC9cQk4")


for VAULT_ADDRESS in ${VAULT_ADDRESSES[@]}
do

FILE_NAME="${VAULT_ADDRESS}_depositors.txt"
if [ -f "${FILE_NAME}" ]; then
    echo "File ${FILE_NAME} exists."
    SLOT=$(grep -o 'slot: [0-9]*' ${FILE_NAME} | awk '{print $2}')
    NEW_FILE_NAME="${SLOT}_${VAULT_ADDRESS}_depositors.txt"
    echo "Renaming ${FILE_NAME} -> ${NEW_FILE_NAME}"
else
    echo "File ${VAULT_ADDRESS}_depositors.txt does not exist."
fi
done