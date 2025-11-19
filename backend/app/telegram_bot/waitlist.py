"""
Waitlist Access Control System for Copilot Bot
==============================================

ARCHITECTURE:
1. Export waitlist emails from Supabase (one-time)
2. Hash emails with salt (privacy protection)
3. Store hashed whitelist on Walrus (immutable, decentralized)
4. Store whitelist blob ID in Sui contract (on-chain reference)
5. Bot checks email against whitelist before registration

PRIVACY FEATURES:
- Emails are hashed (SHA-256 + salt) before storage
- Raw emails never stored on Walrus or blockchain
- Admin can add new emails without revealing existing ones
- Users prove access without exposing email to public
"""

import os
import json
import hashlib
import logging
from typing import List, Dict, Optional, Set
from datetime import datetime
from pathlib import Path
from dotenv import load_dotenv

# Import clients
from app.telegram_bot.walrus_client import WalrusClient
from app.telegram_bot.suiclient import CopilotSuiClient

load_dotenv()
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


class WaitlistManager:
    """
    Manages waitlist migration and access control.

    Process:
    1. Export emails from Supabase
    2. Hash emails for privacy
    3. Upload to Walrus
    4. Store reference on Sui
    5. Validate user access
    """

    def __init__(self, salt: Optional[str] = None):
        """
        Initialize waitlist manager.

        Args:
            salt: Secret salt for hashing (store securely!)
        """
        self.walrus = WalrusClient()
        self.sui = CopilotSuiClient()

        # CRITICAL: Generate and store this salt securely
        # It's needed to verify emails later
        self.salt = salt or os.getenv('WAITLIST_SALT') or self._generate_salt()

        logger.info("Waitlist manager initialized")

    def load_from_csv(self, csv_path: str) -> List[str]:
        """
        Load emails from a CSV file that looks like:

            email
            test@example.com
            john@gmail.com

        No commas, just one email per line under a header.
        """
        emails = []
        try:
            with open(csv_path, 'r') as f:
                lines = [line.strip() for line in f.readlines()]

            if not lines:
                raise ValueError("CSV file is empty")

            if lines[0].lower() != 'email':
                raise ValueError("First line must be 'email'")

            # All remaining lines are email addresses
            for line in lines[1:]:
                if line:
                    emails.append(line)

            logger.info(f"✅ Loaded {len(emails)} emails from CSV")
            return emails

        except Exception as e:
            logger.error(f"Error loading CSV: {e}")
            return []

    def _generate_salt(self) -> str:
        """Generate cryptographic salt for email hashing."""
        import secrets
        salt = secrets.token_hex(32)
        logger.warning("⚠️  Generated new salt - SAVE THIS SECURELY!")
        logger.warning(f"   Add to .env: WAITLIST_SALT={salt}")
        return salt

    def _hash_email(self, email: str) -> str:
        """
        Hash email with salt for privacy-preserving storage.

        Args:
            email: User's email address

        Returns:
            SHA-256 hash of (email + salt)
        """
        # Normalize email (lowercase, strip whitespace)
        normalized = email.lower().strip()

        # Hash with salt
        combined = f"{normalized}{self.salt}"
        hashed = hashlib.sha256(combined.encode()).hexdigest()

        return hashed

    # ==================== SUPABASE MIGRATION ====================

    def export_from_supabase(self, supabase_url: str,
                             supabase_key: str) -> List[str]:
        """
        Export waitlist emails from Supabase (ONE-TIME OPERATION).

        Args:
            supabase_url: Your Supabase project URL
            supabase_key: Service role key (has full access)

        Returns:
            List of email addresses
        """
        try:
            from supabase import create_client

            logger.info("Connecting to Supabase...")
            supabase = create_client(supabase_url, supabase_key)

            # Fetch all waitlist entries
            # Adjust table name and column names to match your schema
            response = supabase.table('waitlist').select('email').execute()

            emails = [record['email'] for record in response.data]

            logger.info(f"✅ Exported {len(emails)} emails from Supabase")

            # Save backup
            backup_path = Path('./waitlist_backup.json')
            with open(backup_path, 'w') as f:
                json.dump({
                    'exported_at': datetime.now().isoformat(),
                    'count': len(emails),
                    'emails': emails  # Keep this file SECURE!
                }, f, indent=2)

            logger.info(f"📁 Backup saved to {backup_path}")
            logger.warning(
                "⚠️  Keep this backup file SECURE and DELETE after migration!")

            return emails

        except Exception as e:
            logger.error(f"Error exporting from Supabase: {e}")
            return []

    def load_from_backup(self, backup_path: str = './waitlist_backup.json') -> List[str]:
        """
        Load emails from backup file (if you already exported).

        Args:
            backup_path: Path to backup JSON file

        Returns:
            List of email addresses
        """
        try:
            with open(backup_path, 'r') as f:
                data = json.load(f)

            emails = data.get('emails', [])
            logger.info(f"✅ Loaded {len(emails)} emails from backup")

            return emails

        except Exception as e:
            logger.error(f"Error loading backup: {e}")
            return []

    # ==================== WHITELIST CREATION ====================

    def create_whitelist(self, emails: List[str],
                         add_admin_emails: bool = True) -> Dict:
        """
        Create privacy-preserving whitelist from emails.

        Args:
            emails: List of email addresses
            add_admin_emails: Add admin emails from .env

        Returns:
            Whitelist data structure
        """
        logger.info(f"Creating whitelist from {len(emails)} emails...")

        # Add admin emails if requested
        if add_admin_emails:
            admin_emails = os.getenv('ADMIN_EMAILS', '').split(',')
            admin_emails = [e.strip() for e in admin_emails if e.strip()]
            emails.extend(admin_emails)
            logger.info(f"Added {len(admin_emails)} admin emails")

        # Remove duplicates
        unique_emails = list(set(emails))
        logger.info(f"Total unique emails: {len(unique_emails)}")

        # Hash all emails
        hashed_emails = [self._hash_email(email) for email in unique_emails]

        # Create whitelist structure
        whitelist = {
            'version': 1,
            'created_at': datetime.now().isoformat(),
            'total_count': len(hashed_emails),
            'hashed_emails': hashed_emails,
            'hash_algorithm': 'sha256',
            'description': 'Copilot waitlist - migrated from Supabase'
        }

        logger.info("✅ Whitelist created")
        logger.info(f"   Total entries: {whitelist['total_count']}")
        logger.info(f"   Hash algorithm: {whitelist['hash_algorithm']}")

        return whitelist

    def upload_whitelist_to_walrus(self, whitelist: Dict) -> Optional[str]:
        """
        Upload whitelist to Walrus (public, but privacy-preserving).

        Args:
            whitelist: Whitelist data structure

        Returns:
            Walrus blob ID
        """
        try:
            logger.info("Uploading whitelist to Walrus...")

            # Convert to JSON bytes
            whitelist_bytes = json.dumps(whitelist).encode('utf-8')

            # Upload to Walrus
            store_url = f"{self.walrus.publisher_url}/v1/blobs?epochs=50"

            import requests
            response = requests.put(
                store_url,
                data=whitelist_bytes,
                headers={'Content-Type': 'application/json'},
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

                logger.info(f"✅ Whitelist uploaded to Walrus")
                logger.info(f"   Blob ID: {blob_id}")
                logger.info(f"   Size: {len(whitelist_bytes)} bytes")
                logger.info(f"   Storage: 50 epochs")

                return blob_id

            logger.error(f"Failed to upload: {response.status_code}")
            return None

        except Exception as e:
            logger.error(f"Error uploading whitelist: {e}")
            return None

    # ==================== ACCESS VERIFICATION ====================

    def is_email_whitelisted(self, email: str,
                             whitelist_blob_id: str) -> bool:
        """
        Check if email is on whitelist (without revealing email).

        Args:
            email: User's email to check
            whitelist_blob_id: Walrus blob ID of whitelist

        Returns:
            True if email is whitelisted
        """
        try:
            # Hash the email
            email_hash = self._hash_email(email)

            # Fetch whitelist from Walrus
            whitelist = self.fetch_whitelist(whitelist_blob_id)

            if not whitelist:
                logger.error("Could not fetch whitelist")
                return False

            # Check if hash is in whitelist
            is_whitelisted = email_hash in whitelist['hashed_emails']

            if is_whitelisted:
                logger.info(f"✅ Email is whitelisted")
            else:
                logger.warning(f"❌ Email is NOT whitelisted")

            return is_whitelisted

        except Exception as e:
            logger.error(f"Error checking whitelist: {e}")
            return False

    def fetch_whitelist(self, blob_id: str) -> Optional[Dict]:
        """
        Fetch whitelist from Walrus.

        Args:
            blob_id: Walrus blob ID

        Returns:
            Whitelist data structure
        """
        try:
            read_url = f"{self.walrus.aggregator_url}/v1/blobs/{blob_id}"

            import requests
            response = requests.get(read_url, timeout=30)

            if response.status_code == 200:
                whitelist = json.loads(response.content.decode('utf-8'))
                return whitelist

            return None

        except Exception as e:
            logger.error(f"Error fetching whitelist: {e}")
            return None

    # ==================== WHITELIST UPDATES ====================

    def add_emails_to_whitelist(self, new_emails: List[str],
                                current_blob_id: str) -> Optional[str]:
        """
        Add new emails to existing whitelist (creates new version).

        Args:
            new_emails: Emails to add
            current_blob_id: Current whitelist blob ID

        Returns:
            New whitelist blob ID
        """
        try:
            logger.info(f"Adding {len(new_emails)} new emails to whitelist...")

            # Fetch current whitelist
            current_whitelist = self.fetch_whitelist(current_blob_id)
            if not current_whitelist:
                logger.error("Could not fetch current whitelist")
                return None

            # Get current hashes
            current_hashes = set(current_whitelist['hashed_emails'])

            # Hash new emails
            new_hashes = [self._hash_email(email) for email in new_emails]

            # Combine (remove duplicates)
            combined_hashes = list(current_hashes | set(new_hashes))

            # Create updated whitelist
            updated_whitelist = {
                'version': current_whitelist['version'] + 1,
                'created_at': datetime.now().isoformat(),
                'previous_blob': current_blob_id,
                'total_count': len(combined_hashes),
                'hashed_emails': combined_hashes,
                'hash_algorithm': 'sha256',
                'description': f"Updated whitelist - added {len(new_hashes)} emails"
            }

            # Upload new version
            new_blob_id = self.upload_whitelist_to_walrus(updated_whitelist)

            if new_blob_id:
                logger.info(f"✅ Whitelist updated")
                logger.info(f"   Old version: {current_blob_id[:16]}...")
                logger.info(f"   New version: {new_blob_id[:16]}...")
                logger.info(f"   Added: {len(new_hashes)} emails")
                logger.info(f"   Total: {len(combined_hashes)} emails")

            return new_blob_id

        except Exception as e:
            logger.error(f"Error updating whitelist: {e}")
            return None

    # ==================== COMPLETE MIGRATION ====================

    def migrate_from_supabase_to_walrus(self,
                                        supabase_url: Optional[str] = None,
                                        supabase_key: Optional[str] = None,
                                        use_backup: bool = False) -> Optional[str]:
        """
        Complete migration from Supabase to Walrus (ONE-TIME).

        Args:
            supabase_url: Supabase project URL (or from .env)
            supabase_key: Supabase service key (or from .env)
            use_backup: Use existing backup file instead of fetching

        Returns:
            Walrus blob ID of whitelist
        """
        print("\n" + "=" * 70)
        print("WAITLIST MIGRATION: SUPABASE → WALRUS")
        print("=" * 70)

        # Step 1: Get emails
        if use_backup:
            print("\n📁 Loading from backup file...")
            emails = self.load_from_backup()
        else:
            print("\n📥 Exporting from Supabase...")
            supabase_url = supabase_url or os.getenv('SUPABASE_URL')
            supabase_key = supabase_key or os.getenv('SUPABASE_SERVICE_KEY')

            if not supabase_url or not supabase_key:
                print("❌ Supabase credentials not found")
                print("   Set SUPABASE_URL and SUPABASE_SERVICE_KEY in .env")
                return None

            emails = self.export_from_supabase(supabase_url, supabase_key)

        if not emails:
            print("❌ No emails to migrate")
            return None

        print(f"✅ Found {len(emails)} emails")

        # Step 2: Create whitelist
        print("\n🔐 Creating privacy-preserving whitelist...")
        whitelist = self.create_whitelist(emails)

        # Step 3: Upload to Walrus
        print("\n☁️  Uploading to Walrus...")
        blob_id = self.upload_whitelist_to_walrus(whitelist)

        if not blob_id:
            print("❌ Failed to upload whitelist")
            return None

        # Step 4: Save migration record
        print("\n📝 Saving migration record...")
        self._save_migration_record(blob_id, len(emails))

        print("\n" + "=" * 70)
        print("✅ MIGRATION COMPLETE!")
        print("=" * 70)
        print(f"\nWhitelist Blob ID: {blob_id}")
        print(f"Total Emails: {len(emails)}")
        print(f"\nNext Steps:")
        print(f"1. Store blob ID in Sui contract")
        print(f"2. Update bot to check whitelist")
        print(f"3. Test with a whitelisted email")
        print(f"4. DELETE the backup file (contains raw emails)")
        print("=" * 70)

        return blob_id

    def _save_migration_record(self, blob_id: str, email_count: int):
        """Save migration record for reference."""
        record = {
            'migration_date': datetime.now().isoformat(),
            'whitelist_blob_id': blob_id,
            'email_count': email_count,
            'salt_used': True,  # Don't save actual salt!
            'storage': 'Walrus decentralized network',
            'hash_algorithm': 'SHA-256'
        }

        Path('./migration_records').mkdir(exist_ok=True)
        filename = f"migration_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"

        with open(f'./migration_records/{filename}', 'w') as f:
            json.dump(record, f, indent=2)

        logger.info(f"Migration record saved: {filename}")


# ==================== EXAMPLE USAGE ====================

def main():
    """Example migration and verification."""

    print("=" * 70)
    print("WAITLIST MIGRATION TOOL")
    print("=" * 70)
    print("\nThis tool helps you migrate waitlist from Supabase to Walrus")
    print("while maintaining privacy through email hashing.")

    # Initialize manager
    manager = WaitlistManager()

    print("\n" + "-" * 70)
    print("CHOOSE OPERATION")
    print("-" * 70)
    print("\n1. Migrate from Supabase (first time)")
    print("2. Migrate from backup file")
    print("3. Add new emails to existing whitelist")
    print("4. Check if email is whitelisted")

    choice = input("\nEnter choice (1-4): ").strip()

    if choice == '1':
        # Fresh migration from Supabase
        print("\n⚠️  You need SUPABASE_URL and SUPABASE_SERVICE_KEY in .env")
        confirm = input("Continue? (y/n): ").strip().lower()

        if confirm == 'y':
            blob_id = manager.migrate_from_supabase_to_walrus(use_backup=False)
            if blob_id:
                print(f"\n✅ Save this blob ID: {blob_id}")

    elif choice == '2':
        csv_path = input("\nPath to CSV file: ").strip()

        print("\n📁 Loading from CSV file...")
        emails = manager.load_from_csv(csv_path)

        if not emails:
            print("❌ No emails loaded from CSV")
            return

        print(f"✅ Found {len(emails)} emails in CSV")

        print("\n🔐 Creating privacy-preserving whitelist...")
        whitelist = manager.create_whitelist(emails)

        print("\n☁️  Uploading to Walrus...")
        blob_id = manager.upload_whitelist_to_walrus(whitelist)

        if blob_id:
            print(f"\n✅ Migration complete! Blob ID: {blob_id}")

    elif choice == '3':
        # Add new emails
        current_blob = input("\nCurrent whitelist blob ID: ").strip()

        print("\nEnter emails to add (one per line, empty line to finish):")
        new_emails = []
        while True:
            email = input().strip()
            if not email:
                break
            new_emails.append(email)

        if new_emails:
            new_blob_id = manager.add_emails_to_whitelist(
                new_emails, current_blob)
            if new_blob_id:
                print(f"\n✅ New whitelist blob ID: {new_blob_id}")

    elif choice == '4':
        # Check email
        blob_id = input("\nWhitelist blob ID: ").strip()
        email = input("Email to check: ").strip()

        is_whitelisted = manager.is_email_whitelisted(email, blob_id)

        if is_whitelisted:
            print("\n✅ This email is on the waitlist!")
        else:
            print("\n❌ This email is NOT on the waitelist")

    else:
        print("\n❌ Invalid choice")


if __name__ == "__main__":
    main()
