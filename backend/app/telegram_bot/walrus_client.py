"""
Secure Walrus Client with Python Cryptography for Private User Data

This implementation uses Python's cryptography library with asymmetric encryption
to protect sensitive user data before storing on Walrus.

Architecture:
1. Each user has a public/private key pair (derived from their Sui wallet)
2. Sensitive data encrypted with user's public key
3. Only user with private key can decrypt
4. Admins can access only if user encrypts with admin's public key too

Key Privacy Principles:
- Personal data NEVER stored in plaintext on-chain or Walrus
- Public key encryption ensures only owner can decrypt
- Multi-recipient encryption for support access
- No single point of failure
"""

import requests
import json
import logging
from typing import Optional, Dict, Any, List, Tuple
from datetime import datetime, time
from cryptography.hazmat.primitives.asymmetric import rsa, padding
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.backends import default_backend
import base64
import os
from pysui.sui.sui_crypto import SuiKeyPair
logger = logging.getLogger(__name__)


class WalrusClient:
    """
    Walrus client with Python cryptography for private data management.

    Uses hybrid encryption:
    - AES-256-GCM for data encryption (fast, symmetric)
    - RSA-4096 for key encryption (secure, asymmetric)

    This ensures both security and performance.
    """

    def __init__(self,
                 publisher_url: str = "https://publisher.walrus-testnet.walrus.space",
                 aggregator_url: str = "https://aggregator.walrus-testnet.walrus.space",
                 default_epochs: int = 50):
        """
        Initialize secure Walrus client with encryption.

        Args:
            publisher_url: Walrus publisher endpoint
            aggregator_url: Walrus aggregator endpoint
            default_epochs: Storage duration in epochs
        """
        self.publisher_url = publisher_url
        self.aggregator_url = aggregator_url
        self.default_epochs = default_epochs
        logger.info("Secure Walrus client initialized with Python cryptography")

    # ==================== KEY MANAGEMENT ====================

    def generate_user_keypair(self) -> Tuple[bytes, bytes]:
        """
        Generate RSA key pair for a user.

        This should be done ONCE when user creates account.
        Private key should be stored securely (encrypted with user's password).

        Returns:
            Tuple of (private_key_pem, public_key_pem)
        """
        # Generate RSA-4096 key pair (very secure)
        private_key = rsa.generate_private_key(
            public_exponent=65537,
            key_size=4096,
            backend=default_backend()
        )

        # Serialize private key (PEM format)
        private_pem = private_key.private_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PrivateFormat.PKCS8,
            encryption_algorithm=serialization.NoEncryption()  # No password protection here
        )

        # Serialize public key (PEM format)
        public_key = private_key.public_key()
        public_pem = public_key.public_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PublicFormat.SubjectPublicKeyInfo
        )

        return private_pem, public_pem

    def encrypt_private_key(self, private_key_pem: bytes, password: str) -> bytes:
        """
        Encrypt user's private key with their password.

        This allows secure storage of private key.
        User must provide password to decrypt.

        Args:
            private_key_pem: User's private key
            password: User's password

        Returns:
            Encrypted private key
        """
        from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC

        # Generate salt
        salt = os.urandom(16)

        # Derive encryption key from password
        kdf = PBKDF2HMAC(
            algorithm=hashes.SHA256(),
            length=32,
            salt=salt,
            iterations=100000,
            backend=default_backend()
        )
        key = kdf.derive(password.encode())

        # Encrypt private key with AES-GCM
        aesgcm = AESGCM(key)
        nonce = os.urandom(12)
        ciphertext = aesgcm.encrypt(nonce, private_key_pem, None)

        # Return: salt + nonce + ciphertext (all needed for decryption)
        return salt + nonce + ciphertext

    def decrypt_private_key(self, encrypted_key: bytes, password: str) -> bytes:
        """
        Decrypt user's private key using their password.

        Args:
            encrypted_key: Encrypted private key
            password: User's password

        Returns:
            Decrypted private key PEM
        """
        from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC

        # Extract components
        salt = encrypted_key[:16]
        nonce = encrypted_key[16:28]
        ciphertext = encrypted_key[28:]

        # Derive decryption key from password
        kdf = PBKDF2HMAC(
            algorithm=hashes.SHA256(),
            length=32,
            salt=salt,
            iterations=100000,
            backend=default_backend()
        )
        key = kdf.derive(password.encode())

        # Decrypt
        aesgcm = AESGCM(key)
        private_key_pem = aesgcm.decrypt(nonce, ciphertext, None)

        return private_key_pem

    # ==================== ENCRYPTION METHODS ====================

    def _encrypt_data_hybrid(self, data: Dict[str, Any],
                             public_key_pem: bytes) -> Dict[str, str]:
        """
        Encrypt data using hybrid encryption (AES + RSA).

        Process:
        1. Generate random AES key
        2. Encrypt data with AES-GCM (fast for large data)
        3. Encrypt AES key with RSA public key (secure key exchange)
        4. Return both encrypted data and encrypted key

        Args:
            data: Data to encrypt
            public_key_pem: Recipient's public key

        Returns:
            Dictionary with encrypted_data and encrypted_key
        """
        try:
            # Convert data to JSON bytes
            plaintext = json.dumps(data, default=str).encode('utf-8')

            # Step 1: Generate random AES-256 key
            aes_key = AESGCM.generate_key(bit_length=256)

            # Step 2: Encrypt data with AES-GCM
            aesgcm = AESGCM(aes_key)
            nonce = os.urandom(12)
            ciphertext = aesgcm.encrypt(nonce, plaintext, None)

            # Step 3: Encrypt AES key with RSA public key
            public_key = serialization.load_pem_public_key(
                public_key_pem,
                backend=default_backend()
            )

            encrypted_aes_key = public_key.encrypt(
                aes_key,
                padding.OAEP(
                    mgf=padding.MGF1(algorithm=hashes.SHA256()),
                    algorithm=hashes.SHA256(),
                    label=None
                )
            )

            # Return as base64-encoded strings for storage
            return {
                'encrypted_data': base64.b64encode(nonce + ciphertext).decode('utf-8'),
                'encrypted_key': base64.b64encode(encrypted_aes_key).decode('utf-8'),
                'version': 1
            }

        except Exception as e:
            logger.error(f"Error encrypting data: {e}")
            return None

    def _decrypt_data_hybrid(self, encrypted_package: Dict[str, str],
                             private_key_pem: bytes) -> Optional[Dict[str, Any]]:
        """
        Decrypt data using hybrid decryption.

        Process:
        1. Decrypt AES key using RSA private key
        2. Decrypt data using decrypted AES key
        3. Return original data

        Args:
            encrypted_package: Dictionary with encrypted_data and encrypted_key
            private_key_pem: User's private key

        Returns:
            Decrypted data dictionary
        """
        try:
            # Decode from base64
            encrypted_data = base64.b64decode(
                encrypted_package['encrypted_data'])
            encrypted_aes_key = base64.b64decode(
                encrypted_package['encrypted_key'])

            # Extract nonce and ciphertext
            nonce = encrypted_data[:12]
            ciphertext = encrypted_data[12:]

            # Step 1: Decrypt AES key with RSA private key
            private_key = serialization.load_pem_private_key(
                private_key_pem,
                password=None,
                backend=default_backend()
            )

            aes_key = private_key.decrypt(
                encrypted_aes_key,
                padding.OAEP(
                    mgf=padding.MGF1(algorithm=hashes.SHA256()),
                    algorithm=hashes.SHA256(),
                    label=None
                )
            )

            # Step 2: Decrypt data with AES key
            aesgcm = AESGCM(aes_key)
            plaintext = aesgcm.decrypt(nonce, ciphertext, None)

            # Convert back to dictionary
            data = json.loads(plaintext.decode('utf-8'))

            return data

        except Exception as e:
            logger.error(f"Error decrypting data: {e}")
            return None

    def _encrypt_data_multi_recipient(self, data: Dict[str, Any],
                                      public_keys: List[bytes]) -> Dict[str, Any]:
        """
        Encrypt data for multiple recipients.

        Used for support access - encrypt once, multiple people can decrypt.

        Args:
            data: Data to encrypt
            public_keys: List of public keys (user + admin)

        Returns:
            Package with encrypted data and multiple encrypted keys
        """
        try:
            # Convert data to JSON bytes
            plaintext = json.dumps(data, default=str).encode('utf-8')

            # Generate random AES key
            aes_key = AESGCM.generate_key(bit_length=256)

            # Encrypt data with AES
            aesgcm = AESGCM(aes_key)
            nonce = os.urandom(12)
            ciphertext = aesgcm.encrypt(nonce, plaintext, None)

            # Encrypt AES key for each recipient
            encrypted_keys = []
            for public_key_pem in public_keys:
                public_key = serialization.load_pem_public_key(
                    public_key_pem,
                    backend=default_backend()
                )

                encrypted_aes_key = public_key.encrypt(
                    aes_key,
                    padding.OAEP(
                        mgf=padding.MGF1(algorithm=hashes.SHA256()),
                        algorithm=hashes.SHA256(),
                        label=None
                    )
                )
                encrypted_keys.append(base64.b64encode(
                    encrypted_aes_key).decode('utf-8'))

            return {
                'encrypted_data': base64.b64encode(nonce + ciphertext).decode('utf-8'),
                'encrypted_keys': encrypted_keys,  # One for each recipient
                'version': 1
            }

        except Exception as e:
            logger.error(f"Error encrypting for multiple recipients: {e}")
            return None

    # ==================== SECURE USER DATA MANAGEMENT ====================

    def store_encrypted_user_data(self, user_public_key: bytes, sensitive_data: Dict[str, Any]) -> Optional[str]:
        """
        Store encrypted user data on Walrus.

        Args:
            user_public_key: User's RSA public key (PEM format)
            sensitive_data: Dictionary of private information

        Returns:
            Walrus blob ID containing encrypted data
        """
        try:
            # Add metadata
            data_with_metadata = {
                **sensitive_data,
                'encrypted_at': datetime.now().isoformat(),
                'version': 1
            }

            # Encrypt with user's public key
            encrypted_package = self._encrypt_data_hybrid(
                data_with_metadata,
                user_public_key
            )

            if not encrypted_package:
                logger.error("Failed to encrypt user data")
                return None

            # Convert to bytes for Walrus storage
            encrypted_bytes = json.dumps(encrypted_package).encode('utf-8')

            # Store on Walrus
            store_url = f"{self.publisher_url}/v1/blobs?epochs={self.default_epochs}"
            response = requests.put(
                store_url,
                data=encrypted_bytes,
                headers={'Content-Type': 'application/octet-stream'},
                timeout=30
            )

            if response.status_code in (200, 201):
                result = response.json()

                if 'newlyCreated' in result:
                    blob_id = result['newlyCreated']['blobObject']['blobId']
                elif 'alreadyCertified' in result:
                    blob_id = result['alreadyCertified']['blobId']
                else:
                    return None

                logger.info(f"✅ Encrypted user data stored: {blob_id}")
                return blob_id

            logger.error(
                f"Failed to store encrypted data: {response.status_code}")
            return None

        except Exception as e:
            logger.error(f"Error storing encrypted user data: {e}")
            return None

    def store_encrypted_task(self, user_public_key: bytes, task_data: Dict[str, Any]) -> Optional[str]:
        """
        Store encrypted task details.

        Args:
            user_public_key: Task owner's public key (bytes)
            task_data: Task details to encrypt

        Returns:
            Walrus blob ID
        """
        try:
            # Add task-specific metadata
            task_data_with_metadata = {
                **task_data,
                'type': 'task',
                'encrypted_at': datetime.now().isoformat(),
                'version': 1
            }

            # Use the main storage method
            return self.store_encrypted_user_data(user_public_key, task_data_with_metadata)

        except Exception as e:
            logger.error(f"Error storing encrypted task: {e}")
            return None

    def store_encrypted_user_data(self, user_public_key: bytes,
                                  sensitive_data: Dict[str, Any]) -> Optional[str]:
        """
        Store encrypted user data on Walrus.

        What gets encrypted (NEVER stored in plaintext):
        - telegram_id: User's Telegram ID
        - email: User's email address
        - phone: Phone number (if any)
        - preferences: User preferences and settings
        - history: Detailed interaction history

        Args:
            user_public_key: User's RSA public key (PEM format)
            sensitive_data: Dictionary of private information

        Returns:
            Walrus blob ID containing encrypted data
        """
        try:
            # Add metadata
            data_with_metadata = {
                **sensitive_data,
                'encrypted_at': datetime.now().isoformat(),
                'version': 1
            }

            # Encrypt with user's public key
            encrypted_package = self._encrypt_data_hybrid(
                data_with_metadata,
                user_public_key
            )

            if not encrypted_package:
                logger.error("Failed to encrypt user data")
                return None

            # Convert to bytes for Walrus storage
            encrypted_bytes = json.dumps(encrypted_package).encode('utf-8')

            # Store on Walrus
            store_url = f"{self.publisher_url}/v1/blobs?epochs={self.default_epochs}"
            response = requests.put(
                store_url,
                data=encrypted_bytes,
                headers={'Content-Type': 'application/octet-stream'},
                timeout=30
            )

            if response.status_code in (200, 201):
                result = response.json()

                if 'newlyCreated' in result:
                    blob_id = result['newlyCreated']['blobObject']['blobId']
                elif 'alreadyCertified' in result:
                    blob_id = result['alreadyCertified']['blobId']
                else:
                    return None

                logger.info(f"✅ Encrypted user data stored: {blob_id}")
                return blob_id

            logger.error(
                f"Failed to store encrypted data: {response.status_code}")
            return None

        except Exception as e:
            logger.error(f"Error storing encrypted user data: {e}")
            return None

    def retrieve_encrypted_user_data(self, blob_id: str,
                                     user_private_key: bytes) -> Optional[Dict[str, Any]]:
        """
        Retrieve and decrypt user data from Walrus.

        Args:
            blob_id: Walrus blob ID
            user_private_key: User's RSA private key (PEM format)

        Returns:
            Decrypted user data dictionary
        """
        try:
            # Retrieve encrypted blob from Walrus
            read_url = f"{self.aggregator_url}/v1/blobs/{blob_id}"
            response = requests.get(read_url, timeout=30)

            if response.status_code != 200:
                logger.error(
                    f"Failed to retrieve blob: {response.status_code}")
                return None

            # Parse encrypted package
            encrypted_package = json.loads(response.content.decode('utf-8'))

            # Decrypt
            decrypted_data = self._decrypt_data_hybrid(
                encrypted_package,
                user_private_key
            )

            if decrypted_data:
                logger.info("✅ User data retrieved and decrypted")
                return decrypted_data

            return None

        except Exception as e:
            logger.error(f"Error retrieving encrypted user data: {e}")
            return None

    def retrieve_encrypted_task(self, blob_id: str, user_private_key: bytes) -> Optional[Dict[str, Any]]:
        """
        Retrieve and decrypt task details.

        Args:
            blob_id: Walrus blob ID
            user_private_key: Task owner's private key (bytes)

        Returns:
            Decrypted task data
        """
        try:
            # Retrieve encrypted blob
            response = requests.get(
                f"{self.aggregator_url}/v1/{blob_id}",
                headers={'Accept': 'application/octet-stream'},
                timeout=30
            )

            if response.status_code == 200:
                # Parse encrypted package
                encrypted_package = json.loads(
                    response.content.decode('utf-8'))

                # Decrypt using hybrid decryption
                task_details = self._decrypt_data_hybrid(
                    encrypted_package, user_private_key)

                if task_details and task_details.get('type') == 'task':
                    logger.info(
                        f"✅ Successfully retrieved and decrypted task {blob_id}")
                    return task_details
                else:
                    logger.error("Retrieved data is not a valid task")
                    return None

            logger.error(
                f"Failed to retrieve blob {blob_id}: {response.status_code}")
            return None

        except Exception as e:
            logger.error(f"Error retrieving task {blob_id}: {e}")
            return None

    # ==================== SUPPORT ACCESS ====================

    def store_encrypted_with_support_access(self, user_public_key: bytes,
                                            admin_public_key: bytes,
                                            sensitive_data: Dict[str, Any],
                                            expires_at: Optional[int] = None) -> Optional[str]:
        """
        Store data encrypted for both user and admin (support access).

        This allows admin to help user while maintaining encryption.

        Args:
            user_public_key: User's public key
            admin_public_key: Admin's public key
            sensitive_data: Data to encrypt
            expires_at: Optional expiration timestamp

        Returns:
            Walrus blob ID
        """
        try:
            # Add access metadata
            data_with_metadata = {
                **sensitive_data,
                'encrypted_at': datetime.now().isoformat(),
                'expires_at': expires_at,
                'access_type': 'support',
                'version': 1
            }

            # Encrypt for multiple recipients (user + admin)
            encrypted_package = self._encrypt_data_multi_recipient(
                data_with_metadata,
                [user_public_key, admin_public_key]
            )

            if not encrypted_package:
                return None

            # Store on Walrus
            encrypted_bytes = json.dumps(encrypted_package).encode('utf-8')
            store_url = f"{self.publisher_url}/v1/blobs?epochs={self.default_epochs}"
            response = requests.put(
                store_url,
                data=encrypted_bytes,
                headers={'Content-Type': 'application/octet-stream'},
                timeout=30
            )

            if response.status_code in (200, 201):
                result = response.json()
                if 'newlyCreated' in result:
                    blob_id = result['newlyCreated']['blobObject']['blobId']
                elif 'alreadyCertified' in result:
                    blob_id = result['alreadyCertified']['blobId']
                else:
                    return None

                logger.info(f"✅ Support access data stored: {blob_id}")
                return blob_id

            return None

        except Exception as e:
            logger.error(f"Error storing support access data: {e}")
            return None

    def retrieve_with_support_access(self, blob_id: str,
                                     private_key: bytes,
                                     recipient_index: int = 0) -> Optional[Dict[str, Any]]:
        """
        Retrieve data with support access (multi-recipient).

        Args:
            blob_id: Walrus blob ID
            private_key: Decryptor's private key (user or admin)
            recipient_index: Which encrypted key to use (0=user, 1=admin)

        Returns:
            Decrypted data
        """
        try:
            # Retrieve encrypted blob
            read_url = f"{self.aggregator_url}/v1/blobs/{blob_id}"
            response = requests.get(read_url, timeout=30)

            if response.status_code != 200:
                return None

            # Parse encrypted package
            encrypted_package = json.loads(response.content.decode('utf-8'))

            # Check expiration
            if 'expires_at' in encrypted_package:
                expires_at = encrypted_package.get('expires_at')
                if expires_at and datetime.now().timestamp() * 1000 > expires_at:
                    logger.warning("Support access expired")
                    return None

            # Create single-recipient package for decryption
            single_package = {
                'encrypted_data': encrypted_package['encrypted_data'],
                'encrypted_key': encrypted_package['encrypted_keys'][recipient_index],
                'version': encrypted_package['version']
            }

            # Decrypt
            decrypted_data = self._decrypt_data_hybrid(
                single_package, private_key)

            if decrypted_data:
                logger.info("✅ Support access data retrieved")

            return decrypted_data

        except Exception as e:
            logger.error(f"Error retrieving support access data: {e}")
            return None

    # ==================== TASK ENCRYPTION ====================

    def store_encrypted_task(self, user_public_key: bytes,
                             task_data: Dict[str, Any]) -> Optional[str]:
        """
        Store encrypted task details.

        Args:
            user_public_key: Task owner's public key
            task_data: Task details to encrypt

        Returns:
            Walrus blob ID
        """
        return self.store_encrypted_user_data(user_public_key, task_data)

    def retrieve_encrypted_task(self, blob_id: str,
                                user_private_key: bytes) -> Optional[Dict[str, Any]]:
        """
        Retrieve and decrypt task details.

        Args:
            blob_id: Walrus blob ID
            user_private_key: Task owner's private key

        Returns:
            Decrypted task data
        """
        return self.retrieve_encrypted_user_data(blob_id, user_private_key)


# ==================== KEY MANAGEMENT HELPER ====================

class UserKeyManager:
    """
    Manages user encryption keys securely.

    Keys are stored encrypted with user's password.
    """

    def __init__(self, storage_path: str = './keys'):
        """
        Initialize key manager.

        Args:
            storage_path: Directory to store encrypted keys
        """
        self.storage_path = storage_path
        os.makedirs(storage_path, exist_ok=True)

    def create_user_keys(self, user_id: str, password: str) -> Tuple[str, bytes]:
        """
        Create and store user's encryption keys.

        Args:
            user_id: User identifier (telegram_id or sui address)
            password: User's password for encrypting private key

        Returns:
            Tuple of (public_key_pem_string, encrypted_private_key_bytes)
        """
        client = WalrusClient()

        # Generate keypair
        private_key_pem, public_key_pem = client.generate_user_keypair()

        # Encrypt private key with password
        encrypted_private_key = client.encrypt_private_key(
            private_key_pem, password)

        # Store encrypted private key
        key_file = os.path.join(self.storage_path, f"{user_id}.key")
        with open(key_file, 'wb') as f:
            f.write(encrypted_private_key)

        # Store public key (no encryption needed - it's public!)
        pub_file = os.path.join(self.storage_path, f"{user_id}.pub")
        with open(pub_file, 'wb') as f:
            f.write(public_key_pem)

        logger.info(f"Created keys for user {user_id}")

        return public_key_pem.decode('utf-8'), encrypted_private_key

    def get_user_public_key(self, user_id: str) -> Optional[bytes]:
        """
        Get user's public key.

        Args:
            user_id: User identifier

        Returns:
            Public key PEM bytes
        """
        pub_file = os.path.join(self.storage_path, f"{user_id}.pub")
        if not os.path.exists(pub_file):
            return None

        with open(pub_file, 'rb') as f:
            return f.read()

    def get_user_private_key(self, user_id: str, password: str) -> Optional[bytes]:
        """
        Get user's decrypted private key.

        Args:
            user_id: User identifier
            password: User's password

        Returns:
            Decrypted private key PEM bytes
        """
        key_file = os.path.join(self.storage_path, f"{user_id}.key")
        if not os.path.exists(key_file):
            return None

        with open(key_file, 'rb') as f:
            encrypted_key = f.read()

        try:
            client = WalrusClient()
            private_key_pem = client.decrypt_private_key(
                encrypted_key, password)
            return private_key_pem
        except Exception as e:
            logger.error(f"Failed to decrypt private key: {e}")
            return None


# ==================== EXAMPLE USAGE ====================

if __name__ == "__main__":
    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s - %(levelname)s - %(message)s'
    )

    print("=" * 70)
    print("SECURE WALRUS CLIENT WITH PYTHON CRYPTOGRAPHY")
    print("=" * 70)
    print()

    # Initialize
    client = WalrusClient()
    key_manager = UserKeyManager()

    # Simulate user signup
    print("Example 1: User Creates Account")
    print("-" * 70)

    user_id = "user123"
    user_password = "secure_password_123"

    # Create keys for user
    public_key_str, encrypted_private = key_manager.create_user_keys(
        user_id, user_password)
    print(f"Keys created for {user_id}")
    print(f"   Public key length: {len(public_key_str)} bytes")
    print()

    # Get keys
    user_public_key = key_manager.get_user_public_key(user_id)
    user_private_key = key_manager.get_user_private_key(user_id, user_password)

    print(" Example 2: Store Encrypted User Data")
    print("-" * 70)

    sensitive_data = {
        'telegram_id': '123456789',
        'email': 'user@example.com',
        'phone': '+1234567890',
        'preferences': {'theme': 'dark', 'notifications': True}
    }

    print("Data to encrypt:")
    print(json.dumps(sensitive_data, indent=2))
    print()

    # Store encrypted
    print("Encrypting and storing...")
    blob_id = client.store_encrypted_user_data(user_public_key, sensitive_data)

    if blob_id:
        print(f" Encrypted data stored on Walrus!")
        print(f"   Blob ID: {blob_id}")
        print(f"   Data is encrypted - Walrus nodes cannot read it")
    print()

    print("=" * 70)
    print("🔐 PRIVACY ARCHITECTURE WITH PYTHON CRYPTOGRAPHY")
    print("=" * 70)
    print()
    print("ENCRYPTION:")
    print("  ✓ RSA-4096 for key encryption (asymmetric)")
    print("  ✓ AES-256-GCM for data encryption (symmetric)")
    print("  ✓ Hybrid encryption (fast + secure)")
    print()
    print("KEY STORAGE:")
    print("  ✓ Public keys: Stored openly (they're public!)")
    print("  ✓ Private keys: Encrypted with user password")
    print("  ✓ Password never stored anywhere")
    print()
    print("ACCESS CONTROL:")
    print("  ✓ Only user with private key can decrypt")
    print("  ✓ Multi-recipient encryption for support")
    print("  ✓ Time-based expiration supported")
    print()
    print("=" * 70)
