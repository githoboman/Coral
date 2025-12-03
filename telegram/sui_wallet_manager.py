"""
Sui Wallet Manager — FINAL PRODUCTION VERSION (DOUBLE-ENCRYPTED)
====================================================================
"""

import os
import json
from pathlib import Path
from typing import Optional, Dict, Any
from datetime import datetime
import base64
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.backends import default_backend
from cryptography.fernet import Fernet
from pysui.sui.sui_crypto import (
    create_new_address,
    recover_key_and_address,
    keypair_from_keystring,
    SignatureScheme
)

# SERVER MASTER KEY — NEVER LOSE THIS (from .env)
SERVER_MASTER_KEY = os.getenv("SERVER_MASTER_KEY")
if not SERVER_MASTER_KEY:
    raise EnvironmentError("SERVER_MASTER_KEY is required in .env for double encryption!")

fernet = Fernet(SERVER_MASTER_KEY)


class SuiWalletManager:
    """Manages Sui wallets with DOUBLE encryption: user password + server master key."""

    def __init__(self, storage_path: str = './user_wallets'):
        self.storage_path = Path(storage_path)
        self.storage_path.mkdir(exist_ok=True)
        try:
            os.chmod(self.storage_path, 0o700)
        except:
            pass

    # -------------------- WALLET CREATION --------------------
    def create_wallet_for_user(self, user_id: str, password: str, word_count: int = 12) -> Dict[str, Any]:
        """
        Create a new Sui wallet for a user.
        Returns: {'address', 'keystring', 'mnemonic'}
        """
        try:
            # Generate new keypair + mnemonic + address
            mnemonic, keypair, address = create_new_address(
                keytype=SignatureScheme.ED25519,
                word_counts=word_count
            )

            # Export keypair as keystring for storage
            keystring = keypair.serialize()

            # STEP 1: Encrypt with user password (same as before)
            encrypted_keystring = self._encrypt_data(keystring.encode(), password)
            encrypted_mnemonic = self._encrypt_data(mnemonic.encode(), password)

            # STEP 2: DOUBLE-ENCRYPT entire wallet data with SERVER_MASTER_KEY
            wallet_data = {
                'address': str(address),
                'encrypted_keystring': encrypted_keystring,
                'encrypted_mnemonic': encrypted_mnemonic,
                'scheme': 'ed25519',
                'created_at': datetime.now().isoformat(),
                'user_id': user_id
            }

            # Final double-encrypted save
            encrypted_wallet_path = self.storage_path / f"{user_id}_wallet.json.enc"
            encrypted_payload = fernet.encrypt(json.dumps(wallet_data, indent=2).encode())
            encrypted_wallet_path.write_bytes(encrypted_payload)

            return {
                'address': str(address),
                'keystring': keystring,
                'mnemonic': mnemonic
            }

        except Exception as e:
            import traceback
            traceback.print_exc()
            raise

    # -------------------- WALLET RETRIEVAL --------------------
    def get_wallet(self, user_id: str, password: str) -> Optional[Any]:
        """Get Sui keypair object for signing."""
        try:
            wallet_file = self.storage_path / f"{user_id}_wallet.json.enc"
            if not wallet_file.exists():
                return None

            # STEP 1: Decrypt with SERVER_MASTER_KEY
            encrypted_data = wallet_file.read_bytes()
            decrypted_json = fernet.decrypt(encrypted_data).decode()
            wallet_data = json.loads(decrypted_json)

            # STEP 2: Decrypt keystring with user password
            keystring = self._decrypt_data(wallet_data['encrypted_keystring'], password).decode()
            keypair = keypair_from_keystring(keystring)
            return keypair

        except Exception as e:
            return None

    def get_wallet_address(self, user_id: str) -> Optional[str]:
        """Get wallet address without password."""
        try:
            wallet_file = self.storage_path / f"{user_id}_wallet.json.enc"
            if not wallet_file.exists():
                return None

            encrypted_data = wallet_file.read_bytes()
            decrypted_json = fernet.decrypt(encrypted_data).decode()
            wallet_data = json.loads(decrypted_json)
            return wallet_data.get('address')
        except Exception as e:
            return None

    def get_address_from_keypair(self, user_id: str, password: str) -> Optional[str]:
        """Get address by deriving from the stored mnemonic."""
        try:
            wallet_file = self.storage_path / f"{user_id}_wallet.json.enc"
            if not wallet_file.exists():
                return None

            encrypted_data = wallet_file.read_bytes()
            decrypted_json = fernet.decrypt(encrypted_data).decode()
            wallet_data = json.loads(decrypted_json)

            mnemonic = self._decrypt_data(wallet_data['encrypted_mnemonic'], password).decode()

            scheme = SignatureScheme.ED25519
            recovered_mnemonic, keypair, address = recover_key_and_address(
                keytype=scheme,
                mnemonics=mnemonic,
                derv_path=""
            )

            return str(address)
        except Exception as e:
            return None

    # -------------------- ORIGINAL AES ENCRYPTION --------------------
    def _encrypt_data(self, data: bytes, password: str) -> str:
        salt = os.urandom(16)
        kdf = PBKDF2HMAC(
            algorithm=hashes.SHA256(),
            length=32,
            salt=salt,
            iterations=100000,
            backend=default_backend()
        )
        key = kdf.derive(password.encode())
        aesgcm = AESGCM(key)
        nonce = os.urandom(12)
        ciphertext = aesgcm.encrypt(nonce, data, None)
        encrypted_data = salt + nonce + ciphertext
        return base64.b64encode(encrypted_data).decode()

    def _decrypt_data(self, encrypted_data: str, password: str) -> bytes:
        encrypted_bytes = base64.b64decode(encrypted_data)
        salt = encrypted_bytes[:16]
        nonce = encrypted_bytes[16:28]
        ciphertext = encrypted_bytes[28:]
        kdf = PBKDF2HMAC(
            algorithm=hashes.SHA256(),
            length=32,
            salt=salt,
            iterations=100000,
            backend=default_backend()
        )
        key = kdf.derive(password.encode())
        aesgcm = AESGCM(key)
        return aesgcm.decrypt(nonce, ciphertext, None)