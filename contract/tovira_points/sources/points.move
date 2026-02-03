#[allow(lint(public_entry), unused_const)]
module tovira_points::points {

    use sui::object::{Self, UID, ID};
    use sui::tx_context::{Self, TxContext};
    use sui::transfer;
    use sui::table::{Self, Table};
    use sui::event;
    use sui::clock::{Self, Clock};
    use std::string::{Self, String};
    use sui::address;

    // =========================================================================
    // ERROR CODES
    // =========================================================================
    const EAlreadyClaimed: u64 = 1;
    const ENotEligible: u64 = 2;
    const EInvalidAmount: u64 = 3;
    const EUserNotFound: u64 = 4;
    const EUnauthorized: u64 = 5;
    const ECheckinTooEarly: u64 = 6;

    // =========================================================================
    // CONSTANTS
    // =========================================================================
    const WAITLIST_POINTS: u64 = 300;
    const CHECKIN_POINTS: u64 = 2;
    const CHECKIN_COOLDOWN_MS: u64 = 86400000; // 24 hours in milliseconds

    // =========================================================================
    // CAPABILITY (admin-only for registry management, NOT for minting)
    // =========================================================================
    public struct AdminCap has key, store {
        id: UID,
    }

    // =========================================================================
    // POINTS REGISTRY  (shared object — one per deployment, ID never changes)
    // =========================================================================
    public struct PointsRegistry has key {
        id: UID,
        /// wallet_address (hex string) -> PointsRecord
        records: Table<String, PointsRecord>,
        /// Total points ever minted across all users
        total_supply: u64,
    }

    public struct PointsRecord has store {
        wallet_address: String,
        balance: u64,
        /// Has this wallet already claimed waitlist points?
        waitlist_claimed: bool,
        /// Timestamp of the first claim (ms)
        claimed_at: u64,
        /// Timestamp of last check-in (ms) - 0 means never checked in
        last_checkin_at: u64,
    }

    // =========================================================================
    // BLOB REGISTRY
    // =========================================================================
    public struct BlobRegistry has key {
        id: UID,
        /// Current Walrus blob ID for the user-profile registry
        current_blob_id: String,
        /// Who can update it
        admin: address,
    }

    // =========================================================================
    // ELIGIBILITY TICKET
    // =========================================================================
    public struct EligibilityTicket has key {
        id: UID,
        /// The wallet this ticket is valid for
        wallet_address: address,
        /// What the ticket grants
        points_amount: u64,
        /// Reason / category
        reason: String,
        /// When it was created (ms)
        created_at: u64,
    }

    // =========================================================================
    // EVENTS
    // =========================================================================
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
        next_checkin_available: u64,
    }

    public struct EligibilityTicketMinted has copy, drop {
        ticket_id: ID,
        wallet_address: address,
        points_amount: u64,
        reason: String,
        timestamp: u64,
    }

    public struct BlobRegistryUpdated has copy, drop {
        old_blob_id: String,
        new_blob_id: String,
        admin: address,
        timestamp: u64,
    }

    // =========================================================================
    // INIT
    // =========================================================================
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

        let admin_cap = AdminCap {
            id: object::new(ctx),
        };

        transfer::share_object(registry);
        transfer::share_object(blob_registry);
        transfer::transfer(admin_cap, deployer);
    }

    // =========================================================================
    // ADMIN: Mint an EligibilityTicket
    // =========================================================================
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
        };

        let ticket_id = object::id(&ticket);

        event::emit(EligibilityTicketMinted {
            ticket_id,
            wallet_address,
            points_amount,
            reason: string::utf8(reason),
            timestamp: clock::timestamp_ms(clock),
        });

        transfer::transfer(ticket, wallet_address);
    }

    // =========================================================================
    // USER: Claim points by consuming an EligibilityTicket
    // =========================================================================
    public entry fun claim_waitlist_points(
        registry: &mut PointsRegistry,
        ticket: EligibilityTicket,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        let caller = tx_context::sender(ctx);

        // Ticket must belong to the caller
        assert!(ticket.wallet_address == caller, EUnauthorized);

        let wallet_key = address_to_string(caller);

        // Check if already claimed (for waitlist tickets specifically)
        if (table::contains(&registry.records, wallet_key)) {
            let record = table::borrow(&registry.records, wallet_key);
            // Only enforce this for waitlist tickets
            if (ticket.reason == string::utf8(b"Waitlist Bonus")) {
                assert!(!record.waitlist_claimed, EAlreadyClaimed);
            };
        };

        let amount = ticket.points_amount;
        let reason = ticket.reason;
        let current_time = clock::timestamp_ms(clock);

        // Destroy the ticket
        let EligibilityTicket { id, wallet_address: _, points_amount: _, reason: _, created_at: _ } = ticket;
        object::delete(id);

        // Credit the points
        if (table::contains(&registry.records, wallet_key)) {
            let record = table::borrow_mut(&mut registry.records, wallet_key);
            record.balance = record.balance + amount;
            // Only mark waitlist_claimed for waitlist tickets
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

    // =========================================================================
    // USER: Check-in (consumes check-in ticket)
    // =========================================================================
    public entry fun checkin(
        registry: &mut PointsRegistry,
        ticket: EligibilityTicket,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        let caller = tx_context::sender(ctx);
        
        // Ticket must belong to the caller
        assert!(ticket.wallet_address == caller, EUnauthorized);
        
        // Ticket must be a check-in ticket
        assert!(ticket.reason == string::utf8(b"Daily Check-in"), EUnauthorized);

        let wallet_key = address_to_string(caller);
        let current_time = clock::timestamp_ms(clock);

        // Verify cooldown if user exists
        if (table::contains(&registry.records, wallet_key)) {
            let record = table::borrow(&registry.records, wallet_key);
            if (record.last_checkin_at > 0) {
                let time_since_last = current_time - record.last_checkin_at;
                assert!(time_since_last >= CHECKIN_COOLDOWN_MS, ECheckinTooEarly);
            };
        };

        // Destroy the ticket
        let EligibilityTicket { id, wallet_address: _, points_amount, reason: _, created_at: _ } = ticket;
        object::delete(id);

        // Update or create record
        if (table::contains(&registry.records, wallet_key)) {
            let record = table::borrow_mut(&mut registry.records, wallet_key);
            record.balance = record.balance + points_amount;
            record.last_checkin_at = current_time;
        } else {
            let record = PointsRecord {
                wallet_address: wallet_key,
                balance: points_amount,
                waitlist_claimed: false,
                claimed_at: current_time,
                last_checkin_at: current_time,
            };
            table::add(&mut registry.records, wallet_key, record);
        };

        registry.total_supply = registry.total_supply + points_amount;

        let new_balance = table::borrow(&registry.records, wallet_key).balance;
        let next_checkin = current_time + CHECKIN_COOLDOWN_MS;

        event::emit(CheckInCompleted {
            wallet_address: caller,
            points_earned: points_amount,
            new_balance,
            timestamp: current_time,
            next_checkin_available: next_checkin,
        });

        event::emit(PointsClaimed {
            wallet_address: caller,
            amount: points_amount,
            reason: string::utf8(b"Daily Check-in"),
            new_balance,
            timestamp: current_time,
        });
    }

    // =========================================================================
    // ADMIN: Update the Walrus blob ID
    // =========================================================================
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

    // =========================================================================
    // READ-ONLY VIEWS
    // =========================================================================

    /// Get a user's point balance (returns 0 if not found)
    public fun get_balance(registry: &PointsRegistry, wallet: String): u64 {
        if (!table::contains(&registry.records, wallet)) {
            return 0
        };
        table::borrow(&registry.records, wallet).balance
    }

    /// Has this wallet already claimed waitlist points?
    public fun has_claimed(registry: &PointsRegistry, wallet: String): bool {
        if (!table::contains(&registry.records, wallet)) {
            return false
        };
        table::borrow(&registry.records, wallet).waitlist_claimed
    }

    /// Get last check-in timestamp (returns 0 if never checked in)
    public fun get_last_checkin(registry: &PointsRegistry, wallet: String): u64 {
        if (!table::contains(&registry.records, wallet)) {
            return 0
        };
        table::borrow(&registry.records, wallet).last_checkin_at
    }

    /// Can user check in now? (true if never checked in or cooldown passed)
    public fun can_checkin(registry: &PointsRegistry, wallet: String, clock: &Clock): bool {
        if (!table::contains(&registry.records, wallet)) {
            return true
        };
        let record = table::borrow(&registry.records, wallet);
        if (record.last_checkin_at == 0) {
            return true
        };
        let current_time = clock::timestamp_ms(clock);
        let time_since_last = current_time - record.last_checkin_at;
        time_since_last >= CHECKIN_COOLDOWN_MS
    }

    /// Total supply of all minted points
    public fun get_total_supply(registry: &PointsRegistry): u64 {
        registry.total_supply
    }

    /// Current Walrus blob ID from BlobRegistry
    public fun get_current_blob_id(blob_registry: &BlobRegistry): String {
        blob_registry.current_blob_id
    }

    // =========================================================================
    // HELPERS
    // =========================================================================

    /// Convert an address to its hex string representation for use as table key
    fun address_to_string(addr: address): String {
        address::to_string(addr)
    }
}
