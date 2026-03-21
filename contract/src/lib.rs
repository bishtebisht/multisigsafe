#![no_std]
use soroban_sdk::{
    contract, contractimpl, contracttype, symbol_short,
    Address, Env, String, Vec, token,
};

const MAX_OWNERS:  u32 = 8;
const MAX_LABEL:   u32 = 60;
const MAX_SAFES:   u32 = 100;

#[contracttype]
#[derive(Clone, PartialEq)]
pub enum SafeStatus {
    Active,     // holding funds, waiting for approvals
    Executed,   // threshold met, funds released
    Cancelled,  // all owners revoked or creator cancelled
}

#[contracttype]
#[derive(Clone)]
pub struct Safe {
    pub id:          u64,
    pub label:       String,
    pub owners:      Vec<Address>,   // all wallets that can sign
    pub threshold:   u32,            // M of N required
    pub recipient:   Address,        // who gets the funds
    pub amount:      i128,           // XLM held
    pub approvals:   Vec<Address>,   // who has approved so far
    pub status:      SafeStatus,
    pub created_by:  Address,
    pub created_at:  u32,
}

#[contracttype]
pub enum DataKey {
    Safe(u64),
    Count,
    OwnerSafes(Address),  // Vec<u64> safes an address is part of
}

fn addr_in(v: &Vec<Address>, a: &Address) -> bool {
    for i in 0..v.len() {
        if v.get(i).unwrap() == *a { return true; }
    }
    false
}

#[contract]
pub struct MultiSigSafeContract;

#[contractimpl]
impl MultiSigSafeContract {
    /// Create a safe: deposit XLM, set owners and threshold
    pub fn create_safe(
        env: Env,
        creator: Address,
        label: String,
        owners: Vec<Address>,
        threshold: u32,
        recipient: Address,
        amount: i128,
        xlm_token: Address,
    ) -> u64 {
        creator.require_auth();
        assert!(label.len() > 0 && label.len() <= MAX_LABEL, "Label 1-60 chars");
        assert!(amount > 0, "Amount must be positive");
        assert!(
            owners.len() >= 2 && owners.len() <= MAX_OWNERS,
            "2-8 owners required"
        );
        assert!(
            threshold >= 1 && threshold <= owners.len(),
            "Threshold must be 1..=owners"
        );
        assert!(addr_in(&owners, &creator), "Creator must be an owner");

        let count: u64 = env.storage().instance()
            .get(&DataKey::Count).unwrap_or(0u64);
        assert!(count < MAX_SAFES as u64, "Safe limit reached");

        let token_client = token::Client::new(&env, &xlm_token);
        token_client.transfer(&creator, &env.current_contract_address(), &amount);

        let id = count + 1;

        // Creator auto-approves
        let mut approvals = Vec::new(&env);
        approvals.push_back(creator.clone());

        let safe = Safe {
            id,
            label,
            owners: owners.clone(),
            threshold,
            recipient,
            amount,
            approvals,
            status: SafeStatus::Active,
            created_by: creator.clone(),
            created_at: env.ledger().sequence(),
        };

        env.storage().persistent().set(&DataKey::Safe(id), &safe);
        env.storage().instance().set(&DataKey::Count, &id);

        // Track safes per owner
        for i in 0..owners.len() {
            let owner = owners.get(i).unwrap();
            let mut owner_safes: Vec<u64> = env.storage().persistent()
                .get(&DataKey::OwnerSafes(owner.clone()))
                .unwrap_or(Vec::new(&env));
            owner_safes.push_back(id);
            env.storage().persistent().set(&DataKey::OwnerSafes(owner), &owner_safes);
        }

        env.events().publish((symbol_short!("created"),), (id, creator, amount));
        id
    }

    /// Owner approves the release — if threshold met, funds transfer immediately
    pub fn approve(
        env: Env,
        owner: Address,
        safe_id: u64,
        xlm_token: Address,
    ) {
        owner.require_auth();

        let mut safe: Safe = env.storage().persistent()
            .get(&DataKey::Safe(safe_id)).expect("Safe not found");

        assert!(safe.status == SafeStatus::Active, "Safe not active");
        assert!(addr_in(&safe.owners, &owner), "Not an owner");
        assert!(!addr_in(&safe.approvals, &owner), "Already approved");

        safe.approvals.push_back(owner.clone());

        // Check if threshold met
        if safe.approvals.len() >= safe.threshold {
            let token_client = token::Client::new(&env, &xlm_token);
            token_client.transfer(
                &env.current_contract_address(),
                &safe.recipient,
                &safe.amount,
            );
            safe.status = SafeStatus::Executed;
            env.events().publish(
                (symbol_short!("executed"),),
                (safe_id, safe.recipient.clone(), safe.amount),
            );
        }

        env.storage().persistent().set(&DataKey::Safe(safe_id), &safe);
        env.events().publish((symbol_short!("approved"),), (safe_id, owner));
    }

    /// Owner revokes their approval
    pub fn revoke(env: Env, owner: Address, safe_id: u64) {
        owner.require_auth();

        let mut safe: Safe = env.storage().persistent()
            .get(&DataKey::Safe(safe_id)).expect("Safe not found");

        assert!(safe.status == SafeStatus::Active, "Safe not active");
        assert!(addr_in(&safe.owners, &owner), "Not an owner");
        assert!(addr_in(&safe.approvals, &owner), "Not yet approved");

        // Remove from approvals
        let mut i = 0u32;
        while i < safe.approvals.len() {
            if safe.approvals.get(i).unwrap() == owner {
                safe.approvals.remove(i);
                break;
            } else { i += 1; }
        }

        env.storage().persistent().set(&DataKey::Safe(safe_id), &safe);
        env.events().publish((symbol_short!("revoked"),), (safe_id, owner));
    }

    /// Creator cancels safe — refunded to creator
    pub fn cancel(env: Env, creator: Address, safe_id: u64, xlm_token: Address) {
        creator.require_auth();

        let mut safe: Safe = env.storage().persistent()
            .get(&DataKey::Safe(safe_id)).expect("Safe not found");

        assert!(safe.created_by == creator, "Not the creator");
        assert!(safe.status == SafeStatus::Active, "Safe not active");

        let token_client = token::Client::new(&env, &xlm_token);
        token_client.transfer(
            &env.current_contract_address(),
            &creator,
            &safe.amount,
        );

        safe.status = SafeStatus::Cancelled;
        env.storage().persistent().set(&DataKey::Safe(safe_id), &safe);
        env.events().publish((symbol_short!("canceld"),), (safe_id,));
    }

    // ── Reads ──────────────────────────────────────────────────────────────
    pub fn get_safe(env: Env, safe_id: u64) -> Safe {
        env.storage().persistent()
            .get(&DataKey::Safe(safe_id)).expect("Safe not found")
    }

    pub fn get_owner_safes(env: Env, owner: Address) -> Vec<u64> {
        env.storage().persistent()
            .get(&DataKey::OwnerSafes(owner))
            .unwrap_or(Vec::new(&env))
    }

    pub fn count(env: Env) -> u64 {
        env.storage().instance().get(&DataKey::Count).unwrap_or(0)
    }
}
