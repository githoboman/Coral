#[allow(lint(public_entry), unused_const)]
module tovira_points::subscriptions {
    use sui::table::{Self, Table};
    use sui::event;
    use sui::clock::{Self, Clock};
    use sui::coin::{Self, Coin};
    use sui::sui::SUI;
    use sui::balance::{Self, Balance};
    use std::string::{Self, String};

    const E_INSUFFICIENT_PAYMENT: u64 = 1;
    const E_SUBSCRIPTION_EXPIRED: u64 = 2;
    const E_PROMPT_LIMIT_REACHED: u64 = 3;
    const E_NOT_ADMIN: u64 = 4;
    const E_INSUFFICIENT_BALANCE: u64 = 5;

    const PREMIUM_PRICE: u64 = 2_000_000_000; 
    const PREMIUM_DURATION_MS: u64 = 30 * 24 * 60 * 60 * 1000;
    const FREE_DAILY_PROMPTS: u64 = 2;
    const PREMIUM_DAILY_PROMPTS: u64 = 5;
    const MS_PER_DAY: u64 = 24 * 60 * 60 * 1000;

    public struct AdminCap has key, store {
        id: UID,
    }

    public struct SubscriptionRegistry has key {
        id: UID,
        subscribers: Table<address, SubscriptionRecord>,
        treasury: Balance<SUI>,
        total_revenue: u64,
        admin: address,
    }

    public struct SubscriptionRecord has store {
        tier: u8, 
        started_at: u64,
        expires_at: u64,
        daily_prompts_used: u64,
        last_prompt_date: u64,
        payment_tx_digest: String,
    }

    public struct PremiumSubscribed has copy, drop {
        wallet_address: address,
        tier: u8,
        started_at: u64,
        expires_at: u64,
        amount_paid: u64,
        timestamp: u64,
    }

    public struct PromptUsed has copy, drop {
        wallet_address: address,
        prompts_used: u64,
        prompts_remaining: u64,
        tier: u8,
        timestamp: u64,
    }

    public struct SubscriptionExpired has copy, drop {
        wallet_address: address,
        expired_at: u64,
        timestamp: u64,
    }

    public struct TreasuryWithdrawn has copy, drop {
        admin: address,
        amount: u64,
        remaining_balance: u64,
        timestamp: u64,
    }

    public struct TreasuryDeposit has copy, drop {
        amount: u64,
        new_balance: u64,
        timestamp: u64,
    }

    fun init(ctx: &mut TxContext) {
        let deployer = tx_context::sender(ctx);

        let registry = SubscriptionRegistry {
            id: object::new(ctx),
            subscribers: table::new(ctx),
            treasury: balance::zero<SUI>(), 
            total_revenue: 0,
            admin: deployer,
        };

        let admin_cap = AdminCap {
            id: object::new(ctx),
        };

        transfer::share_object(registry);
        transfer::transfer(admin_cap, deployer);
    }

    // 🔥 NEW: Public function to deposit coins into treasury
    // This allows the points module to deposit check-in fees
    public fun deposit_to_treasury(
        registry: &mut SubscriptionRegistry,
        payment: Coin<SUI>,
    ) {
        let amount = coin::value(&payment);
        let payment_balance = coin::into_balance(payment);
        balance::join(&mut registry.treasury, payment_balance);
        registry.total_revenue = registry.total_revenue + amount;

        event::emit(TreasuryDeposit {
            amount,
            new_balance: balance::value(&registry.treasury),
            timestamp: 0, // No clock available in this context
        });
    }

    public entry fun subscribe_premium(
        registry: &mut SubscriptionRegistry,
        payment: Coin<SUI>,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        let amount = coin::value(&payment);
        assert!(amount >= PREMIUM_PRICE, E_INSUFFICIENT_PAYMENT);

        let sender = tx_context::sender(ctx);
        let now = clock::timestamp_ms(clock);
        let expires_at = now + PREMIUM_DURATION_MS;

        let payment_balance = coin::into_balance(payment);
        balance::join(&mut registry.treasury, payment_balance);
        
        registry.total_revenue = registry.total_revenue + amount;

        if (table::contains(&registry.subscribers, sender)) {
            let record = table::borrow_mut(&mut registry.subscribers, sender);
            record.tier = 1;
            record.started_at = now;
            record.expires_at = expires_at;
            record.daily_prompts_used = 0;
            record.last_prompt_date = get_day_timestamp(now);
        } else {
            let record = SubscriptionRecord {
                tier: 1,
                started_at: now,
                expires_at,
                daily_prompts_used: 0,
                last_prompt_date: get_day_timestamp(now),
                payment_tx_digest: string::utf8(b""),
            };
            table::add(&mut registry.subscribers, sender, record);
        };

        event::emit(PremiumSubscribed {
            wallet_address: sender,
            tier: 1,
            started_at: now,
            expires_at,
            amount_paid: amount,
            timestamp: now,
        });
    }

    public entry fun withdraw_treasury(
        _admin_cap: &AdminCap,
        registry: &mut SubscriptionRegistry,
        amount: u64,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        let caller = tx_context::sender(ctx);
        
        assert!(caller == registry.admin, E_NOT_ADMIN);

        let treasury_balance = balance::value(&registry.treasury);
        assert!(treasury_balance >= amount, E_INSUFFICIENT_BALANCE);

        let withdrawn_balance = balance::split(&mut registry.treasury, amount);
        let coin = coin::from_balance(withdrawn_balance, ctx);

        transfer::public_transfer(coin, caller);

        let remaining = balance::value(&registry.treasury);
        event::emit(TreasuryWithdrawn {
            admin: caller,
            amount,
            remaining_balance: remaining,
            timestamp: clock::timestamp_ms(clock),
        });
    }

    public entry fun withdraw_all_treasury(
        admin_cap: &AdminCap,
        registry: &mut SubscriptionRegistry,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        let treasury_balance = balance::value(&registry.treasury);
        withdraw_treasury(admin_cap, registry, treasury_balance, clock, ctx);
    }

    public entry fun transfer_admin(
        _admin_cap: &AdminCap,
        registry: &mut SubscriptionRegistry,
        new_admin: address,
        ctx: &mut TxContext,
    ) {
        let caller = tx_context::sender(ctx);
        assert!(caller == registry.admin, E_NOT_ADMIN);
        
        registry.admin = new_admin;
    }

    public fun get_treasury_balance(registry: &SubscriptionRegistry): u64 {
        balance::value(&registry.treasury)
    }

    public entry fun use_task_prompt(
        registry: &mut SubscriptionRegistry,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        let sender = tx_context::sender(ctx);
        let now = clock::timestamp_ms(clock);
        let today = get_day_timestamp(now);

        if (!table::contains(&registry.subscribers, sender)) {
            let record = SubscriptionRecord {
                tier: 0,
                started_at: now,
                expires_at: 0,
                daily_prompts_used: 0,
                last_prompt_date: today,
                payment_tx_digest: string::utf8(b""),
            };
            table::add(&mut registry.subscribers, sender, record);
        };

        let record = table::borrow_mut(&mut registry.subscribers, sender);

        if (record.tier == 1 && record.expires_at < now) {
            record.tier = 0; 
            event::emit(SubscriptionExpired {
                wallet_address: sender,
                expired_at: record.expires_at,
                timestamp: now,
            });
        };

        if (record.last_prompt_date != today) {
            record.daily_prompts_used = 0;
            record.last_prompt_date = today;
        };

        let limit = if (record.tier == 1) { PREMIUM_DAILY_PROMPTS } else { FREE_DAILY_PROMPTS };
        assert!(record.daily_prompts_used < limit, E_PROMPT_LIMIT_REACHED);

        record.daily_prompts_used = record.daily_prompts_used + 1;

        event::emit(PromptUsed {
            wallet_address: sender,
            prompts_used: record.daily_prompts_used,
            prompts_remaining: limit - record.daily_prompts_used,
            tier: record.tier,
            timestamp: now,
        });
    }

    public fun get_subscription(
        registry: &SubscriptionRegistry,
        wallet: address,
    ): (u8, u64, u64, u64, u64) {
        if (!table::contains(&registry.subscribers, wallet)) {
            return (0, 0, 0, 0, 0)
        };

        let record = table::borrow(&registry.subscribers, wallet);
        (
            record.tier,
            record.started_at,
            record.expires_at,
            record.daily_prompts_used,
            record.last_prompt_date,
        )
    }

    public fun can_use_prompt(
        registry: &SubscriptionRegistry,
        wallet: address,
        clock: &Clock,
    ): bool {
        if (!table::contains(&registry.subscribers, wallet)) {
            return true 
        };

        let record = table::borrow(&registry.subscribers, wallet);
        let now = clock::timestamp_ms(clock);
        let today = get_day_timestamp(now);

        if (record.last_prompt_date != today) {
            return true
        };

        let limit = if (record.tier == 1 && record.expires_at >= now) { 
            PREMIUM_DAILY_PROMPTS 
        } else { 
            FREE_DAILY_PROMPTS 
        };

        record.daily_prompts_used < limit
    }

    public fun get_admin(registry: &SubscriptionRegistry): address {
        registry.admin
    }

    fun get_day_timestamp(timestamp_ms: u64): u64 {
        timestamp_ms / MS_PER_DAY
    }
}
