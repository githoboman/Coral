module telegram_bot::referral {
    use sui::object::{Self, UID};
    use sui::transfer;
    use sui::tx_context::{Self, TxContext};
    use sui::event;
    use sui::table::{Self, Table};
    use std::string::{Self, String};
    use telegram_bot::user_management::UserProfile;
    use telegram_bot::rewards;

    const EReferralCodeExists: u64 = 1;
    const EReferralCodeNotFound: u64 = 2;
    const ESelfReferral: u64 = 3;

    public struct ReferralRegistry has key {
        id: UID,
        admin: address,
        referral_codes: Table<String, address>, 
        total_referrals: u64,
    }

    // Events
    public struct ReferralCodeCreated has copy, drop {
        user_address: address,
        referral_code: String,
    }

    public struct ReferralUsed has copy, drop {
        referrer: address,
        referred_user: address,
        referral_code: String,
    }

    
    fun init(ctx: &mut TxContext) {
        let registry = ReferralRegistry {
            id: object::new(ctx),
            admin: tx_context::sender(ctx),
            referral_codes: table::new(ctx),
            total_referrals: 0,
        };
        transfer::share_object(registry);
    }

    // Create referral code
    public entry fun create_referral_code(
        registry: &mut ReferralRegistry,
        code: String,
        ctx: &mut TxContext
    ) {
        let user_address = tx_context::sender(ctx);
        
        assert!(!table::contains(&registry.referral_codes, code), EReferralCodeExists);
        
        table::add(&mut registry.referral_codes, code, user_address);

        event::emit(ReferralCodeCreated {
            user_address,
            referral_code: code,
        });
    }

    public fun use_referral_code(
        registry: &mut ReferralRegistry,
        code: String,
        referred_user: address,
    ): address {
        assert!(table::contains(&registry.referral_codes, code), EReferralCodeNotFound);
        
        let referrer = *table::borrow(&registry.referral_codes, code);
        assert!(referrer != referred_user, ESelfReferral);
        
        registry.total_referrals = registry.total_referrals + 1;

        event::emit(ReferralUsed {
            referrer,
            referred_user,
            referral_code: code,
        });

        referrer
    }

  
    public fun get_referrer_by_code(
        registry: &ReferralRegistry,
        code: String
    ): address {
        assert!(table::contains(&registry.referral_codes, code), EReferralCodeNotFound);
        *table::borrow(&registry.referral_codes, code)
    }
}