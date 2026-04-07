# MultiSigSafe

Lock XLM behind N-of-M wallet approvals. A creator deposits funds and sets a list of owners plus a threshold — for example, 2-of-3 or 4-of-7. Each owner signs independently. When the threshold is reached, the contract automatically releases the full amount to the recipient. No trust required between signers.

## Live Links

| | |
|---|---|
| *Frontend* | https://multisigsafe.vercel.app |
| *Contract* | https://stellar.expert/explorer/testnet/contract/CAFRAAVT7ICR5UUFUGUGSWXG24PSD4VO7SZ5VBUEUCG5ZT7QQLC6GS26 |

## How It Works

1. **Create** a safe — deposit XLM, set owners (2–8), threshold, recipient
2. Creator **auto-approves** on creation (counts toward threshold)
3. Each owner calls **approve** — when approvals reach threshold, funds execute instantly
4. Owners can **revoke** at any time before execution
5. Creator can **cancel** at any time to get refunded

## Contract Functions

```rust
create_safe(creator, label, owners: Vec<Address>, threshold: u32, recipient, amount: i128, xlm_token) -> u64
approve(owner, safe_id, xlm_token)     // auto-executes if threshold met
revoke(owner, safe_id)
cancel(creator, safe_id, xlm_token)    // refunds creator
get_safe(safe_id) -> Safe
get_owner_safes(owner) -> Vec<u64>
count() -> u64
```

## Stack

| Layer | Tech |
|---|---|
| Contract | Rust + Soroban SDK v22 |
| Network | Stellar Testnet |
| Frontend | React 18 + Vite |
| Wallet | Freighter API 6.0.1 |
| Stellar SDK | 14.6.1 |
| Hosting | Vercel |

## Run Locally

```bash
chmod +x scripts/deploy.sh && ./scripts/deploy.sh
cd frontend && npm install && npm run dev
```
