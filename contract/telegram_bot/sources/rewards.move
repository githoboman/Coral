module telegram_bot::rewards {
    use sui::clock::{Self, Clock};
    use sui::event;
    use telegram_bot::user_management::{Self, UserProfile};

    // Error codes
    const EAlreadyCheckedIn: u64 = 1;
    const EInsufficientPoints: u64 = 2;
    const ENotAuthorized: u64 = 3;

    // Reward constants
    const DAILY_CHECKIN_POINTS: u64 = 10;
    const CONSECUTIVE_BONUS: u64 = 5;
    const REFERRAL_REWARD: u64 = 100;
    const PREMIUM_MULTIPLIER: u64 = 2;

    const DAY_IN_MS: u64 = 86400000; // 24 hours

    // Rewards configuration
    public struct RewardsConfig has key {
        id: UID,
        admin: address,
        daily_checkin_reward: u64,
        referral_reward: u64,
        premium_multiplier: u64,
    }

    // Events
    public struct DailyCheckin has copy, drop {
        user_address: address,
        points_earned: u64,
        consecutive_days: u64,
        timestamp: u64,
    }

    public struct PointsRedeemed has copy, drop {
        user_address: address,
        points_spent: u64,
        reward_type: u8,
    }

    public struct ReferralRewarded has copy, drop {
        referrer: address,
        referred_user: address,
        reward_points: u64,
    }


    fun init(ctx: &mut TxContext) {
        let config = RewardsConfig {
            id: object::new(ctx),
            admin: tx_context::sender(ctx),
            daily_checkin_reward: DAILY_CHECKIN_POINTS,
            referral_reward: REFERRAL_REWARD,
            premium_multiplier: PREMIUM_MULTIPLIER,
        }; 
        transfer::share_object(config);
    }

    public entry fun daily_checkin(
        config: &RewardsConfig,
        user_profile: &mut UserProfile,
        clock: &Clock,
        ctx: &mut TxContext
    ) {
        let user_address = tx_context::sender(ctx);
        let current_time = clock::timestamp_ms(clock);
        let last_checkin = user_management::get_last_checkin(user_profile);

        assert!(current_time - last_checkin >= DAY_IN_MS, EAlreadyCheckedIn);

        let base_reward = config.daily_checkin_reward;
        let is_premium = user_management::has_premium_access(user_profile, clock);
        let reward = if (is_premium) {
            base_reward * config.premium_multiplier
        } else {
            base_reward
        };

        let consecutive_bonus = if (last_checkin > 0 && (current_time - last_checkin) <= (DAY_IN_MS * 2)) {
            CONSECUTIVE_BONUS
        } else {
            0
        };

        let total_reward = reward + consecutive_bonus;

        user_management::update_last_checkin(user_profile, current_time);
        user_management::add_points(user_profile, total_reward);

        event::emit(DailyCheckin {
            user_address,
            points_earned: total_reward,
            consecutive_days: if (consecutive_bonus > 0) { 1 } else { 0 }, 
            timestamp: current_time,
        });
    }

    public entry fun redeem_points(
        user_profile: &mut UserProfile,
        points_to_spend: u64,
        reward_type: u8, // 1: discount, 2: feature unlock, etc.
        ctx: &mut TxContext
    ) {
        let success = user_management::deduct_points(user_profile, points_to_spend);
        assert!(success, EInsufficientPoints);

        event::emit(PointsRedeemed {
            user_address: tx_context::sender(ctx),
            points_spent: points_to_spend,
            reward_type,
        });
    }

    public entry fun process_referral_reward(
        config: &RewardsConfig,
        referrer_profile: &mut UserProfile,
        referred_user_address: address,
        ctx: &mut TxContext
    ) {
        let reward = config.referral_reward;
        user_management::add_points(referrer_profile, reward);
        
        user_management::increment_referrals(referrer_profile);

        event::emit(ReferralRewarded {
            referrer: user_management::get_sui_address(referrer_profile),
            referred_user: referred_user_address,
            reward_points: reward,
        });
    }
}