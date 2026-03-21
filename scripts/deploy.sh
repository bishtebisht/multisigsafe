#!/usr/bin/env bash
set -e
GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'

echo -e "${CYAN}MULTISIGSAFE — DEPLOY${NC}"

for KEY in owner1 owner2 owner3 recipient; do
  stellar keys generate --global ${KEY} --network testnet 2>/dev/null || true
done
stellar keys fund owner1 --network testnet
stellar keys fund owner2 --network testnet
stellar keys fund owner3 --network testnet
OWNER1=$(stellar keys address owner1)
OWNER2=$(stellar keys address owner2)
OWNER3=$(stellar keys address owner3)
RECIP=$(stellar keys address recipient)
XLM_TOKEN=$(stellar contract id asset --asset native --network testnet)
echo -e "${GREEN}✓ Owner1: ${OWNER1}${NC}"
echo -e "${GREEN}✓ Owner2: ${OWNER2}${NC}"
echo -e "${GREEN}✓ Owner3: ${OWNER3}${NC}"

cd contract
cargo build --target wasm32-unknown-unknown --release
WASM="target/wasm32-unknown-unknown/release/multisigsafe.wasm"
cd ..

WASM_HASH=$(stellar contract upload --network testnet --source owner1 --wasm contract/${WASM})
CONTRACT_ID=$(stellar contract deploy --network testnet --source owner1 --wasm-hash ${WASM_HASH})
echo -e "${GREEN}✓ CONTRACT_ID: ${CONTRACT_ID}${NC}"

# Approve + create 2-of-3 safe with 10 XLM
stellar contract invoke --network testnet --source owner1 --id ${XLM_TOKEN} \
  -- approve --from ${OWNER1} --spender ${CONTRACT_ID} \
  --amount 100000000 --expiration_ledger 3110400 2>&1 || true

TX_RESULT=$(stellar contract invoke \
  --network testnet --source owner1 --id ${CONTRACT_ID} \
  -- create_safe \
  --creator ${OWNER1} \
  --label '"Team Treasury — 2 of 3"' \
  --owners "[\"${OWNER1}\",\"${OWNER2}\",\"${OWNER3}\"]" \
  --threshold 2 \
  --recipient ${RECIP} \
  --amount 100000000 \
  --xlm_token ${XLM_TOKEN} 2>&1)

TX_HASH=$(echo "$TX_RESULT" | grep -oP '[0-9a-f]{64}' | head -1)
echo -e "${GREEN}✓ Proof TX: ${TX_HASH}${NC}"

cat > frontend/.env << EOF
VITE_CONTRACT_ID=${CONTRACT_ID}
VITE_XLM_TOKEN=${XLM_TOKEN}
VITE_NETWORK_PASSPHRASE=Test SDF Network ; September 2015
VITE_SOROBAN_RPC_URL=https://soroban-testnet.stellar.org
EOF

echo ""
echo -e "${CYAN}CONTRACT : ${CONTRACT_ID}${NC}"
echo -e "${CYAN}PROOF TX : ${TX_HASH}${NC}"
echo -e "${CYAN}EXPLORER : https://stellar.expert/explorer/testnet/contract/${CONTRACT_ID}${NC}"
echo "Next: cd frontend && npm install && npm run dev"
