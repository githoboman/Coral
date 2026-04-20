module bridge::bridge {
    use sui::balance::{Self, Balance};
    use sui::coin::{Self, Coin};
    use sui::sui::SUI;
    use sui::event;
    use sui::table::{Self, Table};
    use std::string::{Self, String};

    // ---- Error codes ----
    const EAmountTooSmall: u64          = 1;
    const EInvalidDestChain: u64        = 2;
    const EInsufficientPoolBalance: u64 = 3;
    const EAlreadyProcessed: u64        = 4;
    const EAmountTooLarge: u64          = 5;
    const EPaused: u64                  = 6;
    const EInvalidMinAmount: u64        = 7;
    const EInvalidFeeBps: u64           = 8;
    const ENoFeesToWithdraw: u64        = 9;
    const EInvalidMaxAmount: u64        = 10;

    // ---- Constants ----
    const DEST_CHAIN_EVM: u8    = 0;
    const DEST_CHAIN_SOLANA: u8 = 1;

    /// Hard ceiling — absolute max regardless of admin setting
    /// Prevents a misconfigured admin from setting an unsafe max
    const HARD_MAX_AMOUNT_MIST: u64 = 1_000_000_000_000_000; // 1,000,000 SUI

    /// Hard cap on fee: 10%
    const MAX_FEE_BPS: u64 = 1_000;

    // ---- Shared pool ----
    public struct BridgePool has key {
        id: UID,
        balance: Balance<SUI>,
        fee_balance: Balance<SUI>,
        /// Minimum bridge amount in MIST
        min_amount_mist: u64,
        /// ✅ NEW: Maximum bridge amount in MIST (configurable by admin)
        max_amount_mist: u64,
        fee_bps: u64,
        request_count: u64,
        processed_source_hashes: Table<String, bool>,
        paused: bool,
    }

    public struct BridgeAdminCap has key, store {
        id: UID,
    }

    // ---- Events ----

    public struct BridgeLockEvent has copy, drop {
        bridge_request_id: u64,
        sender: address,
        dest_chain: u8,
        recipient_address: String,
        gross_amount_mist: u64,
        net_amount_mist: u64,
        fee_mist: u64,
    }

    public struct BridgeReleaseEvent has copy, drop {
        recipient: address,
        gross_amount_mist: u64,
        net_amount_mist: u64,
        fee_mist: u64,
        source_tx_hash: String,
    }

    public struct BridgeFeeWithdrawEvent has copy, drop {
        recipient: address,
        amount_mist: u64,
    }

    // ---- Init ----
    fun init(ctx: &mut TxContext) {
        let pool = BridgePool {
            id: object::new(ctx),
            balance: balance::zero<SUI>(),
            fee_balance: balance::zero<SUI>(),
            min_amount_mist: 10_000_000,         // 0.01 SUI minimum
            max_amount_mist: 1_000_000_000,  // ✅ 1 SUI maximum
            fee_bps: 30,
            request_count: 0,
            processed_source_hashes: table::new(ctx),
            paused: false,
        };

        let admin_cap = BridgeAdminCap { id: object::new(ctx) };
        transfer::share_object(pool);
        transfer::transfer(admin_cap, ctx.sender());
    }

    // ---- User: Lock SUI ----

    public entry fun lock_sui(
        pool: &mut BridgePool,
        coin: Coin<SUI>,
        dest_chain: u8,
        recipient_address: vector<u8>,
        ctx: &mut TxContext,
    ) {
        assert!(!pool.paused, EPaused);

        let gross_amount = coin.value();

        // ✅ Both min and max are now configurable per-pool
        assert!(gross_amount >= pool.min_amount_mist, EAmountTooSmall);
        assert!(gross_amount <= pool.max_amount_mist, EAmountTooLarge);
        assert!(
            dest_chain == DEST_CHAIN_EVM || dest_chain == DEST_CHAIN_SOLANA,
            EInvalidDestChain
        );

        let fee_mist = (gross_amount * pool.fee_bps) / 10_000;
        let net_amount = gross_amount - fee_mist;

        pool.request_count = pool.request_count + 1;

        let mut full_balance = coin.into_balance();
        let fee_split = balance::split(&mut full_balance, fee_mist);
        balance::join(&mut pool.fee_balance, fee_split);
        balance::join(&mut pool.balance, full_balance);

        event::emit(BridgeLockEvent {
            bridge_request_id: pool.request_count,
            sender: ctx.sender(),
            dest_chain,
            recipient_address: string::utf8(recipient_address),
            gross_amount_mist: gross_amount,
            net_amount_mist: net_amount,
            fee_mist,
        });
    }

    // ---- Admin: Release SUI ----

    public entry fun release_sui(
        pool: &mut BridgePool,
        _admin_cap: &BridgeAdminCap,
        recipient: address,
        gross_amount_mist: u64,
        source_tx_hash: vector<u8>,
        ctx: &mut TxContext,
    ) {
        let hash_str = string::utf8(source_tx_hash);
        assert!(
            !table::contains(&pool.processed_source_hashes, hash_str),
            EAlreadyProcessed
        );

        let fee_mist = (gross_amount_mist * pool.fee_bps) / 10_000;
        let net_amount = gross_amount_mist - fee_mist;

        assert!(pool.balance.value() >= gross_amount_mist, EInsufficientPoolBalance);

        let fee_split = balance::split(&mut pool.balance, fee_mist);
        balance::join(&mut pool.fee_balance, fee_split);

        let coin = coin::from_balance(
            balance::split(&mut pool.balance, net_amount),
            ctx
        );
        transfer::public_transfer(coin, recipient);

        table::add(&mut pool.processed_source_hashes, hash_str, true);

        event::emit(BridgeReleaseEvent {
            recipient,
            gross_amount_mist,
            net_amount_mist: net_amount,
            fee_mist,
            source_tx_hash: hash_str,
        });
    }

    // ---- Admin: Fund pool ----
    public entry fun fund_pool(
        pool: &mut BridgePool,
        _admin_cap: &BridgeAdminCap,
        coin: Coin<SUI>,
    ) {
        balance::join(&mut pool.balance, coin.into_balance());
    }

    // ---- Admin: Withdraw fees ----
    public entry fun withdraw_fees(
        pool: &mut BridgePool,
        _admin_cap: &BridgeAdminCap,
        recipient: address,
        ctx: &mut TxContext,
    ) {
        let amount = balance::value(&pool.fee_balance);
        assert!(amount > 0, ENoFeesToWithdraw);

        let coin = coin::from_balance(
            balance::split(&mut pool.fee_balance, amount),
            ctx
        );
        transfer::public_transfer(coin, recipient);
        event::emit(BridgeFeeWithdrawEvent { recipient, amount_mist: amount });
    }

    // ---- Admin: Set fee ----
    public entry fun set_fee_bps(
        pool: &mut BridgePool,
        _admin_cap: &BridgeAdminCap,
        new_fee_bps: u64,
    ) {
        assert!(new_fee_bps <= MAX_FEE_BPS, EInvalidFeeBps);
        pool.fee_bps = new_fee_bps;
    }

    // ---- Admin: Set min amount ----
    public entry fun set_min_amount(
        pool: &mut BridgePool,
        _admin_cap: &BridgeAdminCap,
        new_min_mist: u64,
    ) {
        assert!(new_min_mist > 0, EInvalidMinAmount);
        // ✅ min must always be less than max
        assert!(new_min_mist < pool.max_amount_mist, EInvalidMinAmount);
        pool.min_amount_mist = new_min_mist;
    }

    // ---- Admin: Set max amount ----  ✅ NEW
    public entry fun set_max_amount(
        pool: &mut BridgePool,
        _admin_cap: &BridgeAdminCap,
        new_max_mist: u64,
    ) {
        // max must be above min and below the hard ceiling
        assert!(new_max_mist > pool.min_amount_mist, EInvalidMaxAmount);
        assert!(new_max_mist <= HARD_MAX_AMOUNT_MIST, EInvalidMaxAmount);
        pool.max_amount_mist = new_max_mist;
    }

    // ---- Admin: Pause / Unpause ----
    public entry fun set_paused(
        pool: &mut BridgePool,
        _admin_cap: &BridgeAdminCap,
        paused: bool,
    ) {
        pool.paused = paused;
    }

    // ---- View functions ----

    public fun pool_balance(pool: &BridgePool): u64 {
        pool.balance.value()
    }

    public fun fee_balance(pool: &BridgePool): u64 {
        balance::value(&pool.fee_balance)
    }

    public fun request_count(pool: &BridgePool): u64 {
        pool.request_count
    }

    public fun min_amount(pool: &BridgePool): u64 {
        pool.min_amount_mist
    }

    public fun max_amount(pool: &BridgePool): u64 {
        pool.max_amount_mist
    }

    public fun fee_bps(pool: &BridgePool): u64 {
        pool.fee_bps
    }

    public fun is_paused(pool: &BridgePool): bool {
        pool.paused
    }
}