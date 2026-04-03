#!/bin/bash

# Test script to verify simulation logs are working

echo "Testing request-withdraw with --simulate flag..."
echo "This should show detailed transaction logs"
echo ""

# Replace these with your actual values
VAULT_ADDRESS="FbaXoNjvii97vwqM6m6rgdEarekTJ3ZAdsc1JH5Ym9Gb"
AUTHORITY="3Jft4CvQoLpsd7ouKXrKaET4LHGuMqqYYJSMscXBAbV9"
AMOUNT="1000000"

yarn cli request-withdraw \
  --vault-address $VAULT_ADDRESS \
  --authority $AUTHORITY \
  --amount $AMOUNT \
  --simulate