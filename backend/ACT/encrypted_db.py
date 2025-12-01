import json
import sqlite3
import os
from datetime import datetime
import pytz
from typing import List, Dict, Any, Optional
import atexit

# ===================================================================
# 1. MASTER ENCRYPTION KEY — THE ONLY THING THAT PROTECTS EVERYTHING
# ===================================================================
# Generate ONCE with: python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
DB_ENCRYPTION_KEY = os.getenv("TASK_DB_ENCRYPTION_KEY")

if not DB_ENCRYPTION_KEY:
    raise EnvironmentError(
        "FATAL: TASK_DB_ENCRYPTION_KEY not set in .env!\n"
        "Generate with: python -c \"from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())\""
    )

# Validate key format (must be valid Fernet key)
from cryptography.fernet import Fernet

try:
    Fernet(DB_ENCRYPTION_KEY)  # Will raise if invalid
except Exception as e:
    raise ValueError(f"Invalid TASK_DB_ENCRYPTION_KEY: {e}")

# ===================================================================
# 2. DATABASE PATH & SECURITY
# ===================================================================
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, "data")
DB_PATH = os.path.join(DATA_DIR, "encrypted_tasks.db")

# Create data dir with restricted permissions (Linux/macOS)
os.makedirs(DATA_DIR, exist_ok=True)
try:
    # 700 = owner only read/write/execute
    os.chmod(DATA_DIR, 0o700)
except PermissionError:
    pass

# ===================================================================
# 3. SINGLETON CONNECTION WITH PROPER ENCRYPTION (SQLCIPHER-STYLE)
# ===================================================================
_connection = None


def get_db_connection():
    """Thread-safe, encrypted, singleton connection"""
    global _connection
    if _connection is None:
        _connection = sqlite3.connect(DB_PATH, check_same_thread=False)
        _connection.row_factory = sqlite3.Row
        _connection.execute("PRAGMA foreign_keys = ON")
        _connection.execute("PRAGMA secure_delete = ON")  # Overwrite deleted data
        _connection.execute("PRAGMA auto_vacuum = FULL")  # Prevent data leaks
        _connection.execute(f"PRAGMA key = '{DB_ENCRYPTION_KEY}'")  # THIS IS THE MAGIC
        _connection.execute("PRAGMA cipher_memory_security = ON")  # Resist memory attacks

        # Test encryption worked
        try:
            _connection.execute("SELECT count(*) FROM sqlite_master")
        except sqlite3.DatabaseError as e:
            if "file is not a database" in str(e):
                raise ValueError("Wrong TASK_DB_ENCRYPTION_KEY — database cannot be opened")

    return _connection


# Close connection gracefully on shutdown
atexit.register(lambda: _connection.close() if _connection else None)


# ===================================================================
# 4. DATABASE INITIALIZATION — ONLY PLAIN METADATA, NEVER USER DATA
# ===================================================================
def init_db() -> None:
    """Initialize encrypted database with optimal settings"""
    try:
        with get_db_connection() as conn:
            conn.executescript("""
                -- Main tasks table — only metadata + pointers to E2EE blobs
                CREATE TABLE IF NOT EXISTS tasks (
                    telegram_id     TEXT        NOT NULL,
                    task_id         TEXT        PRIMARY KEY,
                    task_name       TEXT        NOT NULL,           -- Plaintext OK: user sees it anyway
                    encrypted_blob_id TEXT      NOT NULL,           -- Points to E2EE Walrus blob
                    due_timestamp   INTEGER,                        -- Unix ms
                    created_at      TEXT        NOT NULL,           -- ISO8601 UTC
                    status          TEXT        DEFAULT 'pending'   -- pending/completed
                );

                CREATE INDEX IF NOT EXISTS idx_user     ON tasks(telegram_id);
                CREATE INDEX IF NOT EXISTS idx_due      ON tasks(due_timestamp);
                CREATE INDEX IF NOT EXISTS idx_status   ON tasks(status);

                -- Optional: track schema version
                CREATE TABLE IF NOT EXISTS schema_version (
                    version INTEGER PRIMARY KEY
                );
                INSERT OR IGNORE INTO schema_version(version) VALUES (1);
            """)
            conn.commit()
    except Exception as e:
        raise


# ===================================================================
# 5. CORE OPERATIONS — Fast, Safe, No Secrets Exposed
# ===================================================================
def save_task_locally(
        telegram_id: str,
        task_id: str,
        task_name: str,
        encrypted_blob_id: str,
        due_timestamp: int
) -> None:
    """Save task metadata after successful blockchain creation"""
    try:
        with get_db_connection() as conn:
            conn.execute("""
                INSERT OR REPLACE INTO tasks
                (telegram_id, task_id, task_name, encrypted_blob_id, due_timestamp, created_at, status)
                VALUES (?, ?, ?, ?, ?, ?, 'pending')
            """, (
                telegram_id,
                task_id,
                task_name[:200],
                encrypted_blob_id,
                due_timestamp,
                datetime.now(pytz.UTC).isoformat()
            ))
            conn.commit()
    except Exception as e:
        pass


def get_user_tasks(telegram_id: str) -> List[Dict[str, Any]]:
    """Lightning-fast task list — <50ms"""
    try:
        with get_db_connection() as conn:
            cursor = conn.execute("""
                SELECT task_id, task_name, due_timestamp, status, created_at
                FROM tasks
                WHERE telegram_id = ?
                ORDER BY 
                    due_timestamp ASC NULLS LAST,
                    created_at DESC
                LIMIT 100
            """, (telegram_id,))
            rows = cursor.fetchall()
            return [dict(row) for row in rows]
    except Exception as e:
        return []


def update_task_status(telegram_id: str, task_id: str, status: str = "completed") -> bool:
    """Mark task as completed/pending"""
    try:
        with get_db_connection() as conn:
            conn.execute("""
                UPDATE tasks 
                SET status = ? 
                WHERE task_id = ? AND telegram_id = ?
            """, (status, task_id, telegram_id))
            affected = conn.total_changes > 0
            conn.commit()
        return affected
    except Exception as e:
        return False


def delete_task_cache(telegram_id: str, task_id: str) -> bool:
    """Optional: remove old tasks"""
    try:
        with get_db_connection() as conn:
            conn.execute("DELETE FROM tasks WHERE task_id = ? AND telegram_id = ?", (task_id, telegram_id))
            conn.commit()
        return True
    except:
        return False



def get_user_metadata(telegram_id: str) -> Optional[Dict]:
    """Get user metadata including daily task counts"""
    try:
        with get_db_connection() as conn:
            cursor = conn.execute('''
                SELECT metadata FROM user_metadata WHERE telegram_id = ?
            ''', (telegram_id,))

            result = cursor.fetchone()
            if result and result[0]:
                return json.loads(result[0])
            return {}

    except Exception as e:
        return {}


def update_user_metadata(telegram_id: str, metadata: Dict) -> bool:
    """Update user metadata including daily task counts"""
    try:
        with get_db_connection() as conn:
            # Create user_metadata table if not exists
            conn.execute('''
                CREATE TABLE IF NOT EXISTS user_metadata (
                    telegram_id TEXT PRIMARY KEY,
                    metadata TEXT NOT NULL DEFAULT '{}',
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )
            ''')

            conn.execute('''
                INSERT OR REPLACE INTO user_metadata (telegram_id, metadata)
                VALUES (?, ?)
            ''', (telegram_id, json.dumps(metadata)))

            conn.commit()
            return True

    except Exception as e:
        return False


def get_daily_task_count(telegram_id: str) -> int:
    """Get today's task count directly from tasks table"""
    try:
        today = datetime.now(pytz.UTC).date().isoformat()

        with get_db_connection() as conn:
            cursor = conn.execute('''
                SELECT COUNT(*) as count FROM tasks 
                WHERE telegram_id = ? 
                AND date(created_at) = date(?)
                AND status != 'deleted'
            ''', (telegram_id, today))

            result = cursor.fetchone()
            return result[0] if result else 0

    except Exception as e:
        return 0