from pathlib import Path
from dotenv import load_dotenv
load_dotenv()
import os
import json
from cryptography.hazmat.primitives import hashes, hmac
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
from cryptography.fernet import Fernet
import base64

SERVER_MASTER_KEY = os.getenv("SERVER_MASTER_KEY")
if not SERVER_MASTER_KEY:
    raise EnvironmentError("SERVER_MASTER_KEY missing from .env!")

fernet = Fernet(SERVER_MASTER_KEY)

SECURE_DIRS = [
    "registration_receipts",
    "user_keys",
    "user_wallets",
    "user_sessions",
    "user_checkins"
]

# Create dirs with 700 permissions
for d in SECURE_DIRS:
    Path(d).mkdir(exist_ok=True)
    try:
        os.chmod(d, 0o700)
    except:
        pass


# Add to your secure_storage.py

def encrypt_with_server_key(data: str) -> str:
    """Encrypt data with server master key for temporary storage."""
    encrypted = fernet.encrypt(data.encode('utf-8'))
    return base64.urlsafe_b64encode(encrypted).decode()


def decrypt_with_server_key(encrypted_data: str) -> str:
    """Decrypt data encrypted with server master key."""
    try:
        encrypted_bytes = base64.urlsafe_b64decode(encrypted_data.encode())
        decrypted = fernet.decrypt(encrypted_bytes).decode('utf-8')
        return decrypted
    except Exception as e:
        return None


def create_session_token(user_id: str, password: str, expires_in: int = 3600) -> str:
    """Create a time-limited session token."""
    import time
    expires_at = int(time.time()) + expires_in
    token_data = f"{user_id}:{password}:{expires_at}"
    return encrypt_with_server_key(token_data)


def validate_session_token(token: str) -> tuple[str, str] | None:
    """Validate session token and return (user_id, password) if valid."""
    import time
    try:
        decrypted = decrypt_with_server_key(token)
        if not decrypted:
            return None

        user_id, password, expires_at = decrypted.split(':', 2)

        if int(time.time()) > int(expires_at):
            return None

        return user_id, password
    except Exception as e:
        return None


def encrypt_and_save(data: dict | str, filepath: str | Path):
    """Encrypt any data and save to file"""
    filepath = Path(filepath)
    if isinstance(data, dict):
        data = json.dumps(data, indent=2)
    elif not isinstance(data, str):
        data = str(data)

    encrypted = fernet.encrypt(data.encode('utf-8'))
    filepath.write_bytes(encrypted)


def load_and_decrypt(filepath: str | Path) -> dict | str:
    """Load encrypted file and decrypt"""
    filepath = Path(filepath)
    if not filepath.exists():
        return None

    try:
        encrypted = filepath.read_bytes()
        decrypted = fernet.decrypt(encrypted).decode('utf-8')
        # Try to parse JSON
        try:
            return json.loads(decrypted)
        except:
            return decrypted
    except Exception as e:
        return None


def _derive_user_key(user_id: str, password: str, salt: bytes = None) -> tuple[bytes, bytes]:
    """Derive a unique encryption key from user password + user_id"""
    if salt is None:
        salt = os.urandom(16)
    kdf = PBKDF2HMAC(
        algorithm=hashes.SHA256(),
        length=32,
        salt=salt,
        iterations=600_000,  # High security
    )
    key = base64.urlsafe_b64encode(kdf.derive((password + user_id).encode()))
    return key, salt


def encrypt_data(data: dict | str, user_id: str, password: str) -> str:
    """Encrypt data so ONLY the user can decrypt (zero-knowledge)"""
    if isinstance(data, dict):
        data = json.dumps(data)
    elif not isinstance(data, str):
        data = str(data)

    # Use user's password + user_id to derive key
    key, salt = _derive_user_key(user_id, password)
    fernet = Fernet(key)
    encrypted = fernet.encrypt(data.encode('utf-8'))

    # Return: salt + encrypted data (so we can decrypt later)
    return base64.urlsafe_b64encode(salt + encrypted).decode()


def decrypt_data(encrypted_blob: str, user_id: str, password: str) -> dict | str:
    """Decrypt data encrypted with user's password"""
    try:
        data = base64.urlsafe_b64decode(encrypted_blob.encode())
        salt = data[:16]
        encrypted = data[16:]

        key, _ = _derive_user_key(user_id, password, salt)
        fernet = Fernet(key)
        decrypted = fernet.decrypt(encrypted).decode('utf-8')

        try:
            return json.loads(decrypted)
        except:
            return decrypted
    except Exception as e:
        return None

def save_user_checkin_data(user_id: str, password: str, checkin_data: dict):
    """Save user's check-in history encrypted with their password"""
    filepath = Path("user_checkins") / f"{user_id}.enc"
    filepath.parent.mkdir(exist_ok=True)

    encrypted_blob = encrypt_data(checkin_data, user_id, password)
    filepath.write_text(encrypted_blob)


def load_user_checkin_data(user_id: str, password: str) -> dict:
    """Load user's check-in history"""
    filepath = Path("user_checkins") / f"{user_id}.enc"
    if not filepath.exists():
        return {"checkins": [], "total": 0, "last_checkin": None}

    encrypted_blob = filepath.read_text()
    data = decrypt_data(encrypted_blob, user_id, password)
    if isinstance(data, dict):
        return data
    return {"checkins": [], "total": 0, "last_checkin": None}