// Copyright (c) Tovira Labs
// SPDX-License-Identifier: MIT

/// Tovira Points - Non-transferable SoulBound tokens for user achievements
/// 
/// Features:
/// - Non-transferable points (SoulBound to wallet)
/// - Admin-controlled minting
/// - Per-wallet point tracking
/// - Queryable balances
/// 
/// Use Cases:
/// - Waitlist bonus: 300 points
/// - Task completion rewards
/// - Achievement tracking

module tovira_points::points {
    use sui::object::{Self, UID};
    use sui::transfer;
    use sui::tx_context::{Self, TxContext};
    use sui::table::{Self, Table};
    use sui::event;

    // ============================================================================
    // ERRORS
    // ============================================================================
    
    const ENotAuthorized: u64 = 1;
    const EInsufficientPoints: u64 = 2;
    const EInvalidAmount: u64 = 3;

    // ============================================================================
    // STRUCTS
    // ============================================================================

    /// One-time witness for module initialization
    public struct POINTS has drop {}

    /// Admin capability - required for minting points
    public struct AdminCap has key, store {
        id: UID,
    }

    /// Global registry storing all user point balances
    public struct PointsRegistry has key {
        id: UID,
        /// Maps wallet address -> point balance
        balances: Table<address, u64>,
        /// Total points minted across all users
        total_supply: u64,
    }

    /// User's point balance (SoulBound - non-transferable)
    public struct UserPoints has key {
        id: UID,
        /// Owner's wallet address
        owner: address,
        /// Current point balance
        balance: u64,
    }

    // ============================================================================
    // EVENTS
    // ============================================================================

    public struct PointsMinted has copy, drop {
        recipient: address,
        amount: u64,
        new_balance: u64,
        reason: vector<u8>,
    }

    public struct PointsBurned has copy, drop {
        owner: address,
        amount: u64,
        remaining_balance: u64,
    }

    // ============================================================================
    // INITIALIZATION
    // ============================================================================

    /// Module initializer - called once when module is published
    fun init(_witness: POINTS, ctx: &mut TxContext) {
        // Create admin capability
        let admin_cap = AdminCap {
            id: object::new(ctx),
        };

        // Create global points registry
        let registry = PointsRegistry {
            id: object::new(ctx),
            balances: table::new(ctx),
            total_supply: 0,
        };

        // Transfer admin cap to deployer
        transfer::transfer(admin_cap, tx_context::sender(ctx));
        
        // Make registry shared so anyone can read balances
        transfer::share_object(registry);
    }

    // ============================================================================
    // ADMIN FUNCTIONS
    // ============================================================================

    /// Mint points to a user (admin only)
    /// Creates UserPoints object if first time, otherwise updates balance
    public entry fun mint_points(
        _admin: &AdminCap,
        registry: &mut PointsRegistry,
        recipient: address,
        amount: u64,
        reason: vector<u8>,
        ctx: &mut TxContext
    ) {
        assert!(amount > 0, EInvalidAmount);

        // Update registry
        let current_balance = if (table::contains(&registry.balances, recipient)) {
            *table::borrow(&registry.balances, recipient)
        } else {
            0
        };

        let new_balance = current_balance + amount;
        
        if (table::contains(&registry.balances, recipient)) {
            let balance_ref = table::borrow_mut(&mut registry.balances, recipient);
            *balance_ref = new_balance;
        } else {
            table::add(&mut registry.balances, recipient, new_balance);
        };

        registry.total_supply = registry.total_supply + amount;

        // Create UserPoints object for recipient
        let user_points = UserPoints {
            id: object::new(ctx),
            owner: recipient,
            balance: new_balance,
        };

        // Transfer to recipient (SoulBound - they own it but can't transfer)
        transfer::transfer(user_points, recipient);

        // Emit event
        event::emit(PointsMinted {
            recipient,
            amount,
            new_balance,
            reason,
        });
    }

    /// Batch mint points to multiple users (gas efficient)
    public entry fun batch_mint_points(
        admin: &AdminCap,
        registry: &mut PointsRegistry,
        recipients: vector<address>,
        amounts: vector<u64>,
        reason: vector<u8>,
        ctx: &mut TxContext
    ) {
        let len = vector::length(&recipients);
        assert!(len == vector::length(&amounts), EInvalidAmount);

        let mut i = 0;
        while (i < len) {
            let recipient = *vector::borrow(&recipients, i);
            let amount = *vector::borrow(&amounts, i);
            
            mint_points(admin, registry, recipient, amount, reason, ctx);
            i = i + 1;
        };
    }

    /// Burn points from a user (admin only) - useful for penalties or corrections
    public entry fun burn_points(
        _admin: &AdminCap,
        registry: &mut PointsRegistry,
        user: address,
        amount: u64,
    ) {
        assert!(table::contains(&registry.balances, user), EInsufficientPoints);
        
        let current_balance = *table::borrow(&registry.balances, user);
        assert!(current_balance >= amount, EInsufficientPoints);

        let new_balance = current_balance - amount;
        let balance_ref = table::borrow_mut(&mut registry.balances, user);
        *balance_ref = new_balance;

        registry.total_supply = registry.total_supply - amount;

        event::emit(PointsBurned {
            owner: user,
            amount,
            remaining_balance: new_balance,
        });
    }

    // ============================================================================
    // PUBLIC VIEW FUNCTIONS
    // ============================================================================

    /// Get user's point balance from registry
    public fun get_balance(registry: &PointsRegistry, user: address): u64 {
        if (table::contains(&registry.balances, user)) {
            *table::borrow(&registry.balances, user)
        } else {
            0
        }
    }

    /// Get total supply of all points
    public fun get_total_supply(registry: &PointsRegistry): u64 {
        registry.total_supply
    }

    /// Check if user has any points
    public fun has_points(registry: &PointsRegistry, user: address): bool {
        table::contains(&registry.balances, user)
    }

    // ============================================================================
    // USER FUNCTIONS
    // ============================================================================

    /// Users can view their own UserPoints balance
    public fun view_my_points(user_points: &UserPoints): u64 {
        user_points.balance
    }

    /// Get owner of UserPoints object
    public fun get_owner(user_points: &UserPoints): address {
        user_points.owner
    }

    // ============================================================================
    // TESTS
    // ============================================================================

    #[test_only]
    public fun init_for_testing(ctx: &mut TxContext) {
        init(POINTS {}, ctx)
    }
}
