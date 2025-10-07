module telegram_bot::subscription;

use telegram_bot::user_management::{Self, UserProfile};

use sui::coin::{Self, Coin};
use sui::balance::{Self, Balance};
use sui::sui::SUI;
use sui::event;
use sui::clock::{Self, Clock};


const EInsufficientPayment: u64 = 1;
const EInvalidSubscriptionType: u64 = 2;
const ENotAuthorized: u64 = 3;

    // Subscription types
    const MONTHLY_SUBSCRIPTION: u8 = 1;
    const ANNUAL_SUBSCRIPTION: u8 = 2;

    // Prices in MIST (1 SUI = 1,000,000,000 MIST)
    const MONTHLY_PRICE: u64 = 5_000_000; // 0.05 SUI
    const ANNUAL_PRICE: u64 = 20_000_000;  // 0.2 SUI (2 months free)

    // Time constants in milliseconds
    const MONTH_IN_MS: u64 = 2592000000; // 30 days
    const YEAR_IN_MS: u64 = 31536000000;  // 365 days

    public struct Treasury has key {
        id: UID,
        balance: Balance<SUI>,
        admin: address,
        total_revenue: u64,
        active_subscribers: u64,
    }

    public struct SubscriptionRecord has key, store {
        id: UID,
        user_address: address,
        subscription_type: u8,
        start_time: u64,
        end_time: u64,
        amount_paid: u64,
        auto_renew: bool,
    }

    // Events
    public struct SubscriptionPurchased has copy, drop {
        user_address: address,
        subscription_type: u8,
        amount: u64,
        start_time: u64,
        end_time: u64,
    }

    public struct SubscriptionRenewed has copy, drop {
        user_address: address,
        subscription_type: u8,
        new_end_time: u64,
    }

    fun init(ctx: &mut TxContext) {
        let treasury = Treasury {
            id: object::new(ctx),
            balance: balance::zero(),
            admin: tx_context::sender(ctx),
            total_revenue: 0,
            active_subscribers: 0,
        };
        transfer::share_object(treasury);
    }

    // Purchase subscription
    public entry fun purchase_subscription(
        treasury: &mut Treasury,
        user_profile: &mut UserProfile,
        subscription_type: u8,
        payment: Coin<SUI>,
        auto_renew: bool,
        clock: &Clock,
        ctx: &mut TxContext
    ) {
        let user_address = tx_context::sender(ctx);
        let payment_amount = coin::value(&payment);
        let current_time = clock::timestamp_ms(clock);

        // Validate subscription type and payment
        let (required_amount, duration) = if (subscription_type == MONTHLY_SUBSCRIPTION) {
            (MONTHLY_PRICE, MONTH_IN_MS)
        } else if (subscription_type == ANNUAL_SUBSCRIPTION) {
            (ANNUAL_PRICE, YEAR_IN_MS)
        } else {
            abort EInvalidSubscriptionType
        };

        assert!(payment_amount >= required_amount, EInsufficientPayment);

        // Add payment to treasury
        let payment_balance = coin::into_balance(payment);
        balance::join(&mut treasury.balance, payment_balance);
        treasury.total_revenue = treasury.total_revenue + payment_amount;
        treasury.active_subscribers = treasury.active_subscribers + 1;

        // Calculate subscription end time
        let end_time = current_time + duration;

        // Update user profile
        user_management::upgrade_plan(user_profile, 1, end_time, ctx);

        // Create subscription record
        let subscription_record = SubscriptionRecord {
            id: object::new(ctx),
            user_address,
            subscription_type,
            start_time: current_time,
            end_time,
            amount_paid: payment_amount,
            auto_renew,
        };

        event::emit(SubscriptionPurchased {
            user_address,
            subscription_type,
            amount: payment_amount,
            start_time: current_time,
            end_time,
        });

        transfer::transfer(subscription_record, user_address);
    }

    // Renew subscription
    public entry fun renew_subscription(
        treasury: &mut Treasury,
        user_profile: &mut UserProfile,
        subscription_record: &mut SubscriptionRecord,
        payment: Coin<SUI>,
        clock: &Clock,
        ctx: &mut TxContext
    ) {
        let user_address = tx_context::sender(ctx);
        assert!(subscription_record.user_address == user_address, ENotAuthorized);

        let payment_amount = coin::value(&payment);
        let current_time = clock::timestamp_ms(clock);

        // Determine required amount based on existing subscription type
        let (required_amount, duration) = if (subscription_record.subscription_type == MONTHLY_SUBSCRIPTION) {
            (MONTHLY_PRICE, MONTH_IN_MS)
        } else {
            (ANNUAL_PRICE, YEAR_IN_MS)
        };

        assert!(payment_amount >= required_amount, EInsufficientPayment);

        // Add payment to treasury
        let payment_balance = coin::into_balance(payment);
        balance::join(&mut treasury.balance, payment_balance);
        treasury.total_revenue = treasury.total_revenue + payment_amount;

        // Extend subscription
        let new_end_time = if (subscription_record.end_time > current_time) {
            subscription_record.end_time + duration
        } else {
            current_time + duration
        };

        subscription_record.end_time = new_end_time;
        user_management::upgrade_plan(user_profile, 1, new_end_time, ctx);

        event::emit(SubscriptionRenewed {
            user_address,
            subscription_type: subscription_record.subscription_type,
            new_end_time,
        });
    }

    // Admin function to withdraw funds
    public entry fun withdraw_funds(
        treasury: &mut Treasury,
        amount: u64,
        ctx: &mut TxContext
    ) {
        assert!(tx_context::sender(ctx) == treasury.admin, ENotAuthorized);
        
        let withdrawn = coin::take(&mut treasury.balance, amount, ctx);
        transfer::public_transfer(withdrawn, treasury.admin);
    }

    // Getters
    public fun get_monthly_price(): u64 { MONTHLY_PRICE }
    public fun get_annual_price(): u64 { ANNUAL_PRICE }


