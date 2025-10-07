module telegram_bot::user_management;


use sui::clock::{Self, Clock};
use sui::event;


const EUserAlreadyExists: u64 = 0;
const EUserNotFound: u64 = 1;
const ENotAuthorized: u64 = 2;


const PLAN_FREE: u8 = 0;
const PLAN_PREMIUM: u8 = 1;



public struct UserProfile has key, store {
    id: UID,
    telegram_user_id: u64,
    sui_address: address,
    plan_type: u8,
    subscription_expiry: u64,
    points: u64,
    total_referrals: u64,
    referred_by: Option<address>,
    last_checkin: u64,
    created_at: u64,
}


public struct UserRegistry has key {
    id: UID,
    admin: address,
    total_users: u64,
}


public struct UserRegistered has copy, drop, store {
    user_address: address,
    telegram_user_id: u64,
    timestamp: u64,
}


public struct PlanUpgraded has copy, drop, store {
    user_address: address,
    old_plan: u8,
    new_plan: u8,
    expiry: u64,
}


fun init(ctx: &mut TxContext) {
    let registry = UserRegistry {
        id: object::new(ctx),
        admin: tx_context::sender(ctx),
        total_users: 0,
    };
    transfer::share_object(registry)
    }


public entry fun register_user(
    registry: &mut UserRegistry,
    telegram_user_id: u64,
    referred_by: Option<address>,
    clock: &Clock,
    ctx: &mut TxContext
) {
    let user_address = tx_context::sender(ctx);
    let current_time = clock::timestamp_ms(clock);
    
    let user_profile = UserProfile {
        id: object::new(ctx),
        telegram_user_id,
        sui_address: user_address,
        plan_type: PLAN_FREE,
        subscription_expiry: 0,
        points: 100, // Welcome bonus
        total_referrals: 0,
        referred_by,
        last_checkin: 0,
        created_at: current_time,
    };

    registry.total_users = registry.total_users + 1;

    event::emit(UserRegistered {
        user_address,
        telegram_user_id,
        timestamp: current_time,
    });

    transfer::transfer(user_profile, user_address);

    }


public entry fun upgrade_plan(
    user_profile: &mut UserProfile,
    new_plan: u8,
    expiry_timestamp: u64,
    ctx: &mut TxContext
) {
    assert!(tx_context::sender(ctx) == user_profile.sui_address, ENotAuthorized);
    
    let old_plan = user_profile.plan_type;
    user_profile.plan_type = new_plan;
    user_profile.subscription_expiry = expiry_timestamp;

    event::emit(PlanUpgraded {
        user_address: user_profile.sui_address,
        old_plan,
        new_plan,
        expiry: expiry_timestamp,
    });
}

public fun has_premium_access(user_profile: &UserProfile, clock: &Clock): bool {
        if (user_profile.plan_type == PLAN_PREMIUM) {
            let current_time = clock::timestamp_ms(clock);
            return user_profile.subscription_expiry > current_time
        };
        false
    }

public fun add_points(user_profile: &mut UserProfile, points: u64) {
    user_profile.points = user_profile.points + points;
}


public fun deduct_points(user_profile: &mut UserProfile, points: u64): bool {
    if (user_profile.points >= points) {
        user_profile.points = user_profile.points - points;
        return true
    };
    false
}

// Getters
public fun get_user_plan(user_profile: &UserProfile): u8 {
    user_profile.plan_type
}

public fun get_user_points(user_profile: &UserProfile): u64 {
    user_profile.points
}

public fun get_telegram_id(user_profile: &UserProfile): u64 {
    user_profile.telegram_user_id
}

public fun get_last_checkin(profile: &UserProfile): u64 {
profile.last_checkin
}

public fun update_last_checkin(profile: &mut UserProfile, time: u64) {
    profile.last_checkin = time;
}

public fun get_total_referrals(profile: &UserProfile): u64 {
    profile.total_referrals
}

public fun increment_referrals(profile: &mut UserProfile) {
    profile.total_referrals = profile.total_referrals + 1;
}

public fun get_sui_address(profile: &UserProfile): address {
    profile.sui_address
}



