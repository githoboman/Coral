#[allow(lint(public_entry))]
module tovira_points::task_points {
    use sui::table::{Self, Table};
    use sui::event;
    use sui::clock::{Self, Clock};
    use tovira_points::points::{Self, AdminCap, PointsRegistry};
    use std::string::{Self, String};

    const E_ALREADY_CLAIMED: u64 = 1;
    const E_INVALID_TASK_COUNT: u64 = 2;
    const E_UNAUTHORIZED: u64 = 3;

    const POINTS_PER_TASK: u64 = 2;
    const MS_PER_DAY: u64 = 24 * 60 * 60 * 1000;

    public struct TaskPointsRegistry has key {
        id: UID,
        records: Table<address, TaskRecord>,
    }

    public struct TaskRecord has store {
        tasks_created_today: u64,
        tasks_claimed_today: u64,
        last_reset_date: u64,
        total_tasks_created: u64,
        total_points_earned: u64,
    }

    public struct TaskClaimTicket has key {
        id: UID,
        wallet_address: address,
        task_count: u64,
        points_amount: u64,
        created_at: u64,
    }

    public struct TaskPointsClaimed has copy, drop {
        wallet_address: address,
        task_count: u64,
        points_earned: u64,
        new_balance: u64,
        timestamp: u64,
    }

    public struct TaskClaimTicketMinted has copy, drop {
        ticket_id: ID,
        wallet_address: address,
        task_count: u64,
        points_amount: u64,
        timestamp: u64,
    }

    fun init(ctx: &mut TxContext) {
        let registry = TaskPointsRegistry {
            id: object::new(ctx),
            records: table::new(ctx),
        };

        transfer::share_object(registry);
    }

    public entry fun mint_task_claim_ticket(
        _admin: &AdminCap,
        wallet_address: address,
        task_count: u64,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        assert!(task_count > 0, E_INVALID_TASK_COUNT);

        let points_amount = task_count * POINTS_PER_TASK;
        let now = clock::timestamp_ms(clock);

        let ticket = TaskClaimTicket {
            id: object::new(ctx),
            wallet_address,
            task_count,
            points_amount,
            created_at: now,
        };

        let ticket_id = object::id(&ticket);

        event::emit(TaskClaimTicketMinted {
            ticket_id,
            wallet_address,
            task_count,
            points_amount,
            timestamp: now,
        });

        transfer::transfer(ticket, wallet_address);
    }

    public entry fun claim_task_points(
        task_registry: &mut TaskPointsRegistry,
        points_registry: &mut PointsRegistry,
        ticket: TaskClaimTicket,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        let caller = tx_context::sender(ctx);
        let now = clock::timestamp_ms(clock);
        let today = get_day_timestamp(now);

        assert!(ticket.wallet_address == caller, E_UNAUTHORIZED);

        if (!table::contains(&task_registry.records, caller)) {
            let record = TaskRecord {
                tasks_created_today: 0,
                tasks_claimed_today: 0,
                last_reset_date: today,
                total_tasks_created: 0,
                total_points_earned: 0,
            };
            table::add(&mut task_registry.records, caller, record);
        };

        let record = table::borrow_mut(&mut task_registry.records, caller);

        if (record.last_reset_date != today) {
            record.tasks_created_today = 0;
            record.tasks_claimed_today = 0;
            record.last_reset_date = today;
        };

        record.tasks_claimed_today = record.tasks_claimed_today + ticket.task_count;
        record.total_tasks_created = record.total_tasks_created + ticket.task_count;
        record.total_points_earned = record.total_points_earned + ticket.points_amount;

        let wallet_key = address_to_string(caller);
        points::internal_award_points(
            points_registry,
            wallet_key,
            ticket.points_amount,
        );

        let new_balance = points::get_balance(points_registry, wallet_key);

        event::emit(TaskPointsClaimed {
            wallet_address: caller,
            task_count: ticket.task_count,
            points_earned: ticket.points_amount,
            new_balance,
            timestamp: now,
        });

        let TaskClaimTicket { id, wallet_address: _, task_count: _, points_amount: _, created_at: _ } = ticket;
        object::delete(id);
    }

    public fun get_task_record(
        registry: &TaskPointsRegistry,
        wallet: address,
    ): (u64, u64, u64, u64, u64) {
        if (!table::contains(&registry.records, wallet)) {
            return (0, 0, 0, 0, 0)
        };

        let record = table::borrow(&registry.records, wallet);
        (
            record.tasks_created_today,
            record.tasks_claimed_today,
            record.last_reset_date,
            record.total_tasks_created,
            record.total_points_earned,
        )
    }

    fun get_day_timestamp(timestamp_ms: u64): u64 {
        timestamp_ms / MS_PER_DAY
    }

    fun address_to_string(addr: address): String {
        use sui::address;
        address::to_string(addr)
    }
}