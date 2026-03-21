#!/usr/bin/env bash
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
gh repo create multisigsafe --public \
  --description "MultiSigSafe — N-of-M multi-signature XLM vaults on Stellar Soroban" \
  --source "${ROOT}" --remote origin --push
ENV="${ROOT}/frontend/.env"
CONTRACT_ID=$(grep VITE_CONTRACT_ID "$ENV" | cut -d= -f2 | tr -d '[:space:]')
XLM_TOKEN=$(grep VITE_XLM_TOKEN "$ENV" | cut -d= -f2 | tr -d '[:space:]')
USER=$(gh api user -q .login)
gh secret set VITE_CONTRACT_ID --body "$CONTRACT_ID" --repo "$USER/multisigsafe"
gh secret set VITE_XLM_TOKEN   --body "$XLM_TOKEN"   --repo "$USER/multisigsafe"
cd "${ROOT}/frontend" && vercel --prod --yes
echo "✓ MultiSigSafe published!"
