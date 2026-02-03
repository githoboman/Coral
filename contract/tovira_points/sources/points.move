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

    // =========================================================================
    // CONSTANTS
    // =========================================================================
    const WAITLIST_POINTS: u64 = 300;

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

        // Check if already claimed
        if (table::contains(&registry.records, wallet_key)) {
            let record = table::borrow(&registry.records, wallet_key);
            assert!(!record.waitlist_claimed, EAlreadyClaimed);
        };

        let amount = ticket.points_amount;
        let reason = ticket.reason;

        // Destroy the ticket
        let EligibilityTicket { id, wallet_address: _, points_amount: _, reason: _, created_at: _ } = ticket;
        object::delete(id);

        // Credit the points
        if (table::contains(&registry.records, wallet_key)) {
            let record = table::borrow_mut(&mut registry.records, wallet_key);
            record.balance = record.balance + amount;
            record.waitlist_claimed = true;
        } else {
            let record = PointsRecord {
                wallet_address: wallet_key,
                balance: amount,
                waitlist_claimed: true,
                claimed_at: clock::timestamp_ms(clock),
            };
            table::add(&mut registry.records, wallet_key, record);
        };

        registry.total_supply = registry.total_supply + amount;

        event::emit(PointsClaimed {
            wallet_address: caller,
            amount,
            reason,
            new_balance: table::borrow(&registry.records, address_to_string(caller)).balance,
            timestamp: clock::timestamp_ms(clock),
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

    /// Total supply of all minted points
    public fun get_total_supply(registry: &PointsRegistry): u64 {
        registry.total_supply
    }

    /// Current Walrus blob ID from BlobRegistry
    public fun get_current_blob_id(blob_registry: &BlobRegistry): String {
        blob_registry.current_blob_id
    }

    // =========================================================================
    // HELPERS - FIXED VERSION
    // =========================================================================

    /// Convert an address to its hex string representation for use as table key
    /// FIXED: Use address::to_string() which returns proper hex format (0x...)
    fun address_to_string(addr: address): String {
        address::to_string(addr)
    }
}
