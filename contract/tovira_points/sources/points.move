#[allow(lint(public_entry), unused_const)]
module tovira_points::points {

    use sui::table::{Self, Table};
    use sui::event;
    use sui::clock::{Self, Clock};
    use std::string::{Self, String};
    use sui::address;
    use sui::coin::{Self, Coin};
    use sui::sui::SUI;
    use tovira_points::subscriptions::{Self, SubscriptionRegistry};

    const EAlreadyClaimed: u64 = 1;
    const ENotEligible: u64 = 2;
    const EInvalidAmount: u64 = 3;
    const EUserNotFound: u64 = 4;
    const EUnauthorized: u64 = 5;
    const EAlreadyCheckedInToday: u64 = 6;
    const EInsufficientPayment: u64 = 7;

    const WAITLIST_POINTS: u64 = 100;
    const CHECKIN_POINTS: u64 = 1;
    const MILESTONE_BONUS: u64 = 5;

    const MILESTONE_DAYS: vector<u64> = vector[
        5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80
    ];

    public struct AdminCap has key, store {
        id: UID,
    }

    public struct PointsRegistry has key {
        id: UID,
        records: Table<String, PointsRecord>,
        total_supply: u64,
    }

    public struct PointsRecord has store {
        wallet_address: String,
        balance: u64,
        waitlist_claimed: bool,
        claimed_at: u64,
        last_checkin_at: u64,
        current_streak: u64,
        last_checkin_date: String, 
        total_checkins: u64,
    }

    public struct BlobRegistry has key {
        id: UID,
        current_blob_id: String,
        admin: address,
    }

    public struct CheckinFeeConfig has key {
        id: UID,
        fee_amount: u64,
        admin: address,
    }

    public struct EligibilityTicket has key {
        id: UID,
        wallet_address: address,
        points_amount: u64,
        reason: String,
        created_at: u64,
        checkin_date: String,
    }

    public struct PointsClaimed has copy, drop {
        wallet_address: address,
        amount: u64,
        reason: String,
        new_balance: u64,
        timestamp: u64,
    }

    public struct CheckInCompleted has copy, drop {
        wallet_address: address,
        points_earned: u64,
        new_balance: u64,
        timestamp: u64,
        checkin_date: String,
        current_streak: u64,
        is_milestone: bool,
        milestone_bonus: u64,
    }

    public struct EligibilityTicketMinted has copy, drop {
        ticket_id: ID,
        wallet_address: address,
        points_amount: u64,
        reason: String,
        checkin_date: String,
        timestamp: u64,
    }

    public struct BlobRegistryUpdated has copy, drop {
        old_blob_id: String,
        new_blob_id: String,
        admin: address,
        timestamp: u64,
    }

    public struct CheckinFeeCollected has copy, drop {
        wallet_address: address,
        fee_amount: u64,
        timestamp: u64,
    }

    public struct FeeUpdated has copy, drop {
        old_fee: u64,
        new_fee: u64,
        admin: address,
        timestamp: u64,
    }

    fun init(ctx: &mut TxContext) {
        let deployer = tx_context::sender(ctx);

        let registry = PointsRegistry {
            id: object::new(ctx),
            records: table::new(ctx),
            total_supply: 0,
        };

        let blob_registry = BlobRegistry {
            id: object::new(ctx),
            current_blob_id: string::utf8(b""),
            admin: deployer,
        };

        let fee_config = CheckinFeeConfig {
            id: object::new(ctx),
            fee_amount: 2_000_000, // 0.002 SUI in MIST
            admin: deployer,
        };

        let admin_cap = AdminCap {
            id: object::new(ctx),
        };

        transfer::share_object(registry);
        transfer::share_object(blob_registry);
        transfer::share_object(fee_config);
        transfer::transfer(admin_cap, deployer);
    }

    public entry fun update_checkin_fee(
        _admin_cap: &AdminCap,
        fee_config: &mut CheckinFeeConfig,
        new_fee: u64,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        let caller = tx_context::sender(ctx);
        assert!(caller == fee_config.admin, EUnauthorized);

        let old_fee = fee_config.fee_amount;
        fee_config.fee_amount = new_fee;

        event::emit(FeeUpdated {
            old_fee,
            new_fee,
            admin: caller,
            timestamp: clock::timestamp_ms(clock),
        });
    }

    public fun get_checkin_fee(fee_config: &CheckinFeeConfig): u64 {
        fee_config.fee_amount
    }

    public entry fun mint_eligibility_ticket(
        _admin: &AdminCap,
        wallet_address: address,
        points_amount: u64,
        reason: vector<u8>,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        assert!(points_amount > 0, EInvalidAmount);

        let ticket = EligibilityTicket {
            id: object::new(ctx),
            wallet_address,
            points_amount,
            reason: string::utf8(reason),
            created_at: clock::timestamp_ms(clock),
            checkin_date: string::utf8(b""), 
        };

        let ticket_id = object::id(&ticket);

        event::emit(EligibilityTicketMinted {
            ticket_id,
            wallet_address,
            points_amount,
            reason: string::utf8(reason),
            checkin_date: string::utf8(b""),
            timestamp: clock::timestamp_ms(clock),
        });

        transfer::transfer(ticket, wallet_address);
    }

    public entry fun mint_checkin_ticket(
        _admin: &AdminCap,
        wallet_address: address,
        points_amount: u64,
        checkin_date: vector<u8>, 
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        assert!(points_amount > 0, EInvalidAmount);

        let ticket = EligibilityTicket {
            id: object::new(ctx),
            wallet_address,
            points_amount,
            reason: string::utf8(b"Daily Check-in"),
            created_at: clock::timestamp_ms(clock),
            checkin_date: string::utf8(checkin_date),
        };

        let ticket_id = object::id(&ticket);

        event::emit(EligibilityTicketMinted {
            ticket_id,
            wallet_address,
            points_amount,
            reason: string::utf8(b"Daily Check-in"),
            checkin_date: string::utf8(checkin_date),
            timestamp: clock::timestamp_ms(clock),
        });

        transfer::transfer(ticket, wallet_address);
    }

    public entry fun claim_waitlist_points(
        registry: &mut PointsRegistry,
        ticket: EligibilityTicket,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        let caller = tx_context::sender(ctx);

        assert!(ticket.wallet_address == caller, EUnauthorized);

        let wallet_key = address_to_string(caller);

        if (table::contains(&registry.records, wallet_key)) {
            let record = table::borrow(&registry.records, wallet_key);
            if (ticket.reason == string::utf8(b"Waitlist Bonus")) {
                assert!(!record.waitlist_claimed, EAlreadyClaimed);
            };
        };

        let amount = ticket.points_amount;
        let reason = ticket.reason;
        let current_time = clock::timestamp_ms(clock);

        let EligibilityTicket { 
            id, 
            wallet_address: _, 
            points_amount: _, 
            reason: _, 
            created_at: _,
            checkin_date: _
        } = ticket;
        object::delete(id);

        if (table::contains(&registry.records, wallet_key)) {
            let record = table::borrow_mut(&mut registry.records, wallet_key);
            record.balance = record.balance + amount;
            if (reason == string::utf8(b"Waitlist Bonus")) {
                record.waitlist_claimed = true;
            };
        } else {
            let record = PointsRecord {
                wallet_address: wallet_key,
                balance: amount,
                waitlist_claimed: (reason == string::utf8(b"Waitlist Bonus")),
                claimed_at: current_time,
                last_checkin_at: 0,
                current_streak: 0,
                last_checkin_date: string::utf8(b""),
                total_checkins: 0,
            };
            table::add(&mut registry.records, wallet_key, record);
        };

        registry.total_supply = registry.total_supply + amount;

        event::emit(PointsClaimed {
            wallet_address: caller,
            amount,
            reason,
            new_balance: table::borrow(&registry.records, address_to_string(caller)).balance,
            timestamp: current_time,
        });
    }

    fun is_milestone_day(streak: u64): bool {
        let milestones = vector[5u64, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80];
        let mut i = 0;
        let len = vector::length(&milestones);
        
        while (i < len) {
            if (*vector::borrow(&milestones, i) == streak) {
                return true
            };
            i = i + 1;
        };
        
        false
    }

    fun are_dates_consecutive(date1: &String, date2: &String): bool {
        date1 != date2
    }

    public entry fun checkin(
        registry: &mut PointsRegistry,
        subscription_registry: &mut SubscriptionRegistry,
        ticket: EligibilityTicket,
        fee_config: &CheckinFeeConfig,
        mut payment: Coin<SUI>, 
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        let caller = tx_context::sender(ctx);
        
        assert!(ticket.wallet_address == caller, EUnauthorized);
        assert!(ticket.reason == string::utf8(b"Daily Check-in"), EUnauthorized);

        let wallet_key = address_to_string(caller);
        let current_time = clock::timestamp_ms(clock);
        let checkin_date = ticket.checkin_date;

        assert!(*string::bytes(&checkin_date) != *string::bytes(&string::utf8(b"")), EUnauthorized);

        let fee_amount = fee_config.fee_amount;
        let payment_value = coin::value(&payment);
        
        assert!(payment_value >= fee_amount, EInsufficientPayment);

        let fee_coin = coin::split(&mut payment, fee_amount, ctx);
        
        // Return change to user
        if (coin::value(&payment) > 0) {
            transfer::public_transfer(payment, caller);
        } else {
            coin::destroy_zero(payment);
        };

        // 🔥 FIX: Deposit fee into subscription treasury instead of transferring
        subscriptions::deposit_to_treasury(subscription_registry, fee_coin);

        event::emit(CheckinFeeCollected {
            wallet_address: caller,
            fee_amount,
            timestamp: current_time,
        });

        let mut new_streak = 1u64;
        let mut is_milestone = false;
        let mut milestone_bonus = 0u64;
        let base_points = CHECKIN_POINTS;

        if (table::contains(&registry.records, wallet_key)) {
            let record = table::borrow(&registry.records, wallet_key);
            
            if (record.last_checkin_date == checkin_date) {
                abort EAlreadyCheckedInToday
            };

            if (*string::bytes(&record.last_checkin_date) != *string::bytes(&string::utf8(b""))) {
                if (are_dates_consecutive(&record.last_checkin_date, &checkin_date)) {
                    new_streak = record.current_streak + 1;
                } else {
                    new_streak = 1;
                };
            };
        };

        if (is_milestone_day(new_streak)) {
            is_milestone = true;
            milestone_bonus = MILESTONE_BONUS;
        };

        let total_points = base_points + milestone_bonus;

        let EligibilityTicket { 
            id, 
            wallet_address: _, 
            points_amount: _, 
            reason: _, 
            created_at: _,
            checkin_date: _
        } = ticket;
        object::delete(id);

        if (table::contains(&registry.records, wallet_key)) {
            let record = table::borrow_mut(&mut registry.records, wallet_key);
            record.balance = record.balance + total_points;
            record.last_checkin_at = current_time;
            record.current_streak = new_streak;
            record.last_checkin_date = checkin_date;
            record.total_checkins = record.total_checkins + 1;
        } else {
            let record = PointsRecord {
                wallet_address: wallet_key,
                balance: total_points,
                waitlist_claimed: false,
                claimed_at: current_time,
                last_checkin_at: current_time,
                current_streak: new_streak,
                last_checkin_date: checkin_date,
                total_checkins: 1,
            };
            table::add(&mut registry.records, wallet_key, record);
        };

        registry.total_supply = registry.total_supply + total_points;

        let new_balance = table::borrow(&registry.records, wallet_key).balance;

        event::emit(CheckInCompleted {
            wallet_address: caller,
            points_earned: total_points,
            new_balance,
            timestamp: current_time,
            checkin_date,
            current_streak: new_streak,
            is_milestone,
            milestone_bonus,
        });

        event::emit(PointsClaimed {
            wallet_address: caller,
            amount: total_points,
            reason: string::utf8(b"Daily Check-in"),
            new_balance,
            timestamp: current_time,
        });
    }

    public(package) fun internal_award_points(
        registry: &mut PointsRegistry,
        wallet_key: String,
        amount: u64,
    ) {
        if (table::contains(&registry.records, wallet_key)) {
            let record = table::borrow_mut(&mut registry.records, wallet_key);
            record.balance = record.balance + amount;
        } else {
            let record = PointsRecord {
                wallet_address: wallet_key,
                balance: amount,
                waitlist_claimed: false,
                claimed_at: 0,
                last_checkin_at: 0,
                current_streak: 0,
                last_checkin_date: string::utf8(b""),
                total_checkins: 0,
            };
            table::add(&mut registry.records, wallet_key, record);
        };

        registry.total_supply = registry.total_supply + amount;
    }

    public entry fun update_blob_id(
        _admin: &AdminCap,
        blob_registry: &mut BlobRegistry,
        new_blob_id: vector<u8>,
        clock: &Clock,
        _ctx: &mut TxContext,
    ) {
        let old = blob_registry.current_blob_id;
        blob_registry.current_blob_id = string::utf8(new_blob_id);

        event::emit(BlobRegistryUpdated {
            old_blob_id: old,
            new_blob_id: blob_registry.current_blob_id,
            admin: blob_registry.admin,
            timestamp: clock::timestamp_ms(clock),
        });
    }

    public fun get_balance(registry: &PointsRegistry, wallet: String): u64 {
        if (!table::contains(&registry.records, wallet)) {
            return 0
        };
        table::borrow(&registry.records, wallet).balance
    }

    public fun has_claimed(registry: &PointsRegistry, wallet: String): bool {
        if (!table::contains(&registry.records, wallet)) {
            return false
        };
        table::borrow(&registry.records, wallet).waitlist_claimed
    }

    public fun get_last_checkin(registry: &PointsRegistry, wallet: String): u64 {
        if (!table::contains(&registry.records, wallet)) {
            return 0
        };
        table::borrow(&registry.records, wallet).last_checkin_at
    }

    public fun get_last_checkin_date(registry: &PointsRegistry, wallet: String): String {
        if (!table::contains(&registry.records, wallet)) {
            return string::utf8(b"")
        };
        table::borrow(&registry.records, wallet).last_checkin_date
    }

    public fun get_current_streak(registry: &PointsRegistry, wallet: String): u64 {
        if (!table::contains(&registry.records, wallet)) {
            return 0
        };
        table::borrow(&registry.records, wallet).current_streak
    }

    public fun get_total_checkins(registry: &PointsRegistry, wallet: String): u64 {
        if (!table::contains(&registry.records, wallet)) {
            return 0
        };
        table::borrow(&registry.records, wallet).total_checkins
    }

    public fun get_total_supply(registry: &PointsRegistry): u64 {
        registry.total_supply
    }

    public fun get_current_blob_id(blob_registry: &BlobRegistry): String {
        blob_registry.current_blob_id
    }

    fun address_to_string(addr: address): String {
        address::to_string(addr)
    }
}
