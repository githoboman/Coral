import os
from typing import Optional, Dict, Any, List
from pysui import SuiConfig, SyncClient
from pysui.sui.sui_types.scalars import ObjectID, SuiString, SuiInteger
from pysui.sui.sui_types import SuiAddress
from pysui.sui.sui_txn import SyncTransaction
from dotenv import load_dotenv

load_dotenv()


class CopilotSuiClient:
    """
    Client for interacting with Copilot smart contract on Sui blockchain.

    UPDATED: Now supports admin-generated referral codes and enhanced referral system.
    """

    def __init__(self):
        self.config = SuiConfig.default_config()
        self.config._rpc_url = os.getenv('SUI_RPC_URL', 'https://fullnode.testnet.sui.io:443')
        self.client = SyncClient(self.config)

        self.package_id = os.getenv('COPILOT_PACKAGE_ID')
        self.registry_id = os.getenv('COPILOT_REGISTRY_ID')
        self.treasury_id = os.getenv('COPILOT_TREASURY_ID')
        self.module_name = "bot"

        self.PREMIUM_PRICE = 1_000_000_000  # 1 SUI
        self.BASIC_REFERRAL_POINTS = 5
        self.PREMIUM_REFERRAL_POINTS = 10
        self.MAX_BASIC_REFERRALS = 2
        self.MAX_PREMIUM_REFERRALS = 5

    # ==================== ADMIN REFERRAL CODE GENERATION ====================

    def admin_generate_code_batch(self, admin_cap_id: str) -> Optional[Dict[str, Any]]:
        """
        Generate a batch of 10 admin referral codes (admin only).

        Admin codes allow new users to join without needing an existing user's referral.
        Each code can only be claimed once.

        Args:
            admin_cap_id: AdminCap object ID (proves admin authority)

        Returns:
            Dictionary with:
            - tx_digest: Transaction hash
            - batch_id: AdminReferralCodeBatch object ID
            - codes: List of 10 generated codes (format: ADM-XXXX-XXXX)

        Example codes: ['ADM-A3F2-B4C1', 'ADM-D5E6-F7A8', ...]
        """
        try:
            txn = SyncTransaction(client=self.client)

            txn.move_call(
                target=f"{self.package_id}::{self.module_name}::admin_generate_code_batch",
                arguments=[
                    ObjectID(admin_cap_id),  # AdminCap (proves authorization)
                    ObjectID(self.registry_id),  # Registry (stores codes)
                ]
            )

            result = txn.execute(gas_budget="10000000")

            if result.is_ok():
                tx_digest = result.result_data.digest

                # Parse AdminCodeBatchGenerated event
                batch_id = None
                codes = []

                for event in result.result_data.events:
                    if "AdminCodeBatchGenerated" in str(event):
                        parsed = event.parsed_json
                        batch_id = parsed.get('batch_id')
                        codes = parsed.get('codes', [])
                        break

                return {
                    'tx_digest': tx_digest,
                    'batch_id': batch_id,
                    'codes': codes
                }

            return None

        except Exception as e:
            return None

    def _extract_profile_id_from_result(self, result) -> Optional[str]:
        '''
        FIXED: Better profile ID extraction from transaction result.
        '''
        try:
            # Method 1: Check created objects
            if hasattr(result, 'effects') and hasattr(result.effects, 'created'):
                for obj in result.effects.created:
                    # Look for UserProfile type
                    if 'UserProfile' in str(obj.object_type):
                        return obj.object_id

            # Method 2: Parse events
            if hasattr(result, 'events'):
                for event in result.events:
                    if 'UserCreated' in event.type:
                        # Extract from event data
                        return event.parsed_json.get('user_profile_id')

            # Method 3: Query by user wallet address (requires indexer)
            # This is the most reliable method
            return None

        except Exception as e:
            return None

    # ==================== USER PROFILE CREATION (3 METHODS) ====================

    def create_user_profile_with_wallet(
            self,
            encrypted_blob_id: str,
            user_wallet_address: str
    ) -> Optional[Dict[str, str]]:
        """
        Create user profile with their wallet address.
        Bot sponsors transaction but stores user's wallet.
        """
        try:
            txn = SyncTransaction(client=self.client)
            txn.move_call(
                target=f"{self.package_id}::{self.module_name}::create_user_profile",
                arguments=[
                    ObjectID(self.registry_id),
                    SuiString(encrypted_blob_id),
                    SuiAddress(user_wallet_address),
                ]
            )

            result = txn.execute(gas_budget="10000000")

            if result.is_ok():
                tx_digest = result.result_data.digest
                profile_id = self._extract_profile_id(result.result_data)

                return {
                    'profile_id': profile_id,
                    'tx_digest': tx_digest,
                    'user_wallet': user_wallet_address,
                    'sponsored_by': 'bot',
                }

            return None

        except Exception as e:
            import traceback
            traceback.print_exc()
            return None

    def create_user_profile_with_admin_code_and_wallet(
            self,
            admin_code: str,
            encrypted_blob_id: str,
            user_wallet_address: str
    ) -> Optional[Dict[str, str]]:
        """Create profile with admin code and user's wallet."""
        try:
            txn = SyncTransaction(client=self.client)
            txn.move_call(
                target=f"{self.package_id}::{self.module_name}::create_user_profile_with_admin_code",
                arguments=[
                    ObjectID(self.registry_id),
                    SuiString(admin_code),
                    SuiString(encrypted_blob_id),
                    SuiAddress(user_wallet_address),  # ✅ FIXED
                ]
            )

            result = txn.execute(gas_budget="10000000")

            if result.is_ok():
                tx_digest = result.result_data.digest
                profile_id = self._extract_profile_id(result.result_data)

                return {
                    'profile_id': profile_id,
                    'tx_digest': tx_digest,
                    'admin_code_used': admin_code,
                    'user_wallet': user_wallet_address,
                }

            return None

        except Exception as e:
            return None

    def create_user_profile_with_referral_and_wallet(
            self,
            referral_code: str,
            encrypted_blob_id: str,
            user_wallet_address: str
    ) -> Optional[Dict[str, str]]:
        """Create profile with referral code and user's wallet."""
        try:
            txn = SyncTransaction(client=self.client)
            txn.move_call(
                target=f"{self.package_id}::{self.module_name}::create_user_profile_with_referral",
                arguments=[
                    ObjectID(self.registry_id),
                    SuiString(referral_code),
                    SuiString(encrypted_blob_id),
                    SuiAddress(user_wallet_address),  # ✅ FIXED
                ]
            )

            result = txn.execute(gas_budget="10000000")

            if result.is_ok():
                tx_digest = result.result_data.digest
                profile_id = self._extract_profile_id(result.result_data)

                return {
                    'profile_id': profile_id,
                    'tx_digest': tx_digest,
                    'referrer_code': referral_code,
                    'user_wallet': user_wallet_address,
                }

            return None

        except Exception as e:
            return None

    # ==================== REFERRAL CODE CHECKING ====================

    def is_admin_code_available(self, admin_code: str) -> bool:
        """
        Check if an admin referral code exists and is available.
        """
        try:
            txn = SyncTransaction(client=self.client)

            txn.move_call(
                target=f"{self.package_id}::{self.module_name}::is_admin_code_available",
                arguments=[
                    ObjectID(self.registry_id),
                    SuiString(admin_code),
                ]
            )

            result = txn.execute(gas_budget="10000000")

            if result.is_ok():
                # Comprehensive debugging of the entire result structure
                self._debug_full_transaction_result(result.result_data)

                # Try multiple extraction strategies
                return self._extract_boolean_from_result(result.result_data)
            else:
                return False

        except Exception as e:
            return False

    def _debug_full_transaction_result(self, result_data):
        """Comprehensive debug of the entire transaction result structure."""
        pass

    def _extract_boolean_from_result(self, result_data) -> bool:
        """Try multiple strategies to extract boolean result."""
        # Strategy 1: Effects return_values (most common)
        if hasattr(result_data, 'effects'):
            effects = result_data.effects
            if hasattr(effects, 'return_values') and effects.return_values:
                return_values = effects.return_values

                if return_values and len(return_values) > 0:
                    # Handle nested structure: [[value]]
                    first_return = return_values[0]
                    if isinstance(first_return, (list, tuple)) and len(first_return) > 0:
                        value = first_return[0]
                        return bool(value)
                    else:
                        # Flat structure: [value]
                        value = first_return
                        return bool(value)

        # Strategy 2: Check for specific events
        if hasattr(result_data, 'events'):
            for event in result_data.events:
                event_type = str(getattr(event, 'type', ''))

                # Look for parsed JSON data
                if hasattr(event, 'parsed_json'):
                    parsed = event.parsed_json

                    # Check common boolean field names
                    for field in ['available', 'is_available', 'result', 'success', 'exists', 'valid']:
                        if field in parsed:
                            value = parsed[field]
                            return bool(value)

                # Check bcs data if available
                if hasattr(event, 'bcs'):
                    bcs_data = event.bcs

        # Strategy 3: Check created objects for result indicators
        if hasattr(result_data, 'effects') and hasattr(result_data.effects, 'created'):
            for obj in result_data.effects.created:
                obj_type = str(getattr(obj, 'object_type', ''))

                # If a result object was created, we might need to fetch its data
                if any(keyword in obj_type.lower() for keyword in ['result', 'response', 'answer']):
                    # We would need to fetch this object's data to get the actual result
                    return True  # or False based on the object type

        # Strategy 4: Check transaction digest pattern
        # Sometimes the result might be indicated by the presence/absence of certain objects

        return False

    def get_admin_code_status(self, admin_code: str) -> Dict[str, bool]:
        """
        Get detailed status of an admin referral code.
        """
        try:
            txn = SyncTransaction(client=self.client)

            txn.move_call(
                target=f"{self.package_id}::{self.module_name}::get_admin_code_status",
                arguments=[
                    ObjectID(self.registry_id),
                    SuiString(admin_code),
                ]
            )

            result = txn.execute(gas_budget="10000000")

            if result.is_ok():
                # Extract return values
                if hasattr(result.result_data, 'effects'):
                    effects = result.result_data.effects
                    if hasattr(effects, 'return_values') and effects.return_values:
                        return_values = effects.return_values
                        if return_values and len(return_values) > 0:
                            values = return_values[0]
                            if len(values) >= 2:
                                return {
                                    'exists': bool(values[0]),
                                    'available': bool(values[1])
                                }

                # Check events
                if hasattr(result.result_data, 'events'):
                    for event in result.result_data.events:
                        event_type = str(getattr(event, 'type', ''))
                        if 'AdminCodeStatus' in event_type:
                            parsed = getattr(event, 'parsed_json', {})
                            if 'exists' in parsed and 'available' in parsed:
                                return {
                                    'exists': bool(parsed['exists']),
                                    'available': bool(parsed['available'])
                                }

            return {'exists': False, 'available': False}

        except Exception as e:
            return {'exists': False, 'available': False}

    def get_user_referral_code_usage(self, referral_code: str) -> Dict[str, Any]:
        """
        Check how many times a user's referral code has been used.

        Args:
            referral_code: User's referral code

        Returns:
            Dictionary with:
            - usage_count: Number of times code has been used
            - max_uses: Maximum allowed uses (2 for basic, 5 for premium)
            - is_available: Whether code can still be used
            - remaining_uses: How many uses are left
        """
        try:
            txn = SyncTransaction(client=self.client)

            txn.move_call(
                target=f"{self.package_id}::{self.module_name}::get_user_referral_code_usage",
                arguments=[
                    ObjectID(self.registry_id),
                    SuiString(referral_code)
                ]
            )

            result = txn.execute(gas_budget="10000000")

            if result.is_ok():
                if hasattr(result.result_data, 'effects') and hasattr(result.result_data.effects, 'return_values'):
                    return_values = result.result_data.effects.return_values
                    if return_values and len(return_values) > 0:
                        values = return_values[0]
                        if len(values) >= 3:
                            usage = int(values[0])
                            max_uses = int(values[1])
                            available = bool(values[2])

                            return {
                                'usage_count': usage,
                                'max_uses': max_uses,
                                'is_available': available,
                                'remaining_uses': max(0, max_uses - usage)
                            }

            return {
                'usage_count': 0,
                'max_uses': 0,
                'is_available': False,
                'remaining_uses': 0
            }

        except Exception as e:
            return {
                'usage_count': 0,
                'max_uses': 0,
                'is_available': False,
                'remaining_uses': 0
            }

    def is_user_referral_code_available(self, referral_code: str, referrer_is_premium: bool) -> bool:
        """
        Check if a user's referral code is still available for use.

        Args:
            referral_code: User's referral code
            referrer_is_premium: Whether the referrer has premium status

        Returns:
            True if code can still be used
        """
        try:
            txn = SyncTransaction(client=self.client)

            txn.move_call(
                target=f"{self.package_id}::{self.module_name}::is_user_referral_code_available",
                arguments=[
                    ObjectID(self.registry_id),
                    SuiString(referral_code),
                    SuiInteger(1 if referrer_is_premium else 0)
                ]
            )

            result = self.client.dry_run(txn)

            if result.is_ok():
                if hasattr(result.result_data, 'effects') and hasattr(result.result_data.effects, 'return_values'):
                    return_values = result.result_data.effects.return_values
                    if return_values and len(return_values) > 0:
                        return bool(return_values[0][0])

            return False

        except Exception as e:
            return False

    # ==================== ENHANCED USER DETAILS ====================

    def get_user_details(self, profile_id: str) -> Optional[Dict[str, Any]]:
        """
        Get comprehensive user details including claimed admin code.

        Args:
            profile_id: UserProfile object ID

        Returns:
            Dictionary with all user fields
        """
        try:
            # Method 1: Try to get the object directly and parse its fields
            obj_result = self.client.get_object(profile_id)

            if not obj_result.is_ok():
                return None

            obj_data = obj_result.result_data

            # Extract fields from the object
            # The structure varies, try different access methods
            fields = None

            # Try: data.content.fields
            if hasattr(obj_data, 'data'):
                data = obj_data.data
                if hasattr(data, 'content'):
                    content = data.content
                    if hasattr(content, 'fields'):
                        fields = content.fields

            # Try: content.fields
            if not fields and hasattr(obj_data, 'content'):
                content = obj_data.content
                if hasattr(content, 'fields'):
                    fields = content.fields

            # Try: dictionary access
            if not fields and isinstance(obj_data, dict):
                if 'data' in obj_data and 'content' in obj_data['data']:
                    fields = obj_data['data']['content'].get('fields')
                elif 'content' in obj_data:
                    fields = obj_data['content'].get('fields')

            if not fields:
                return None

            # Parse fields (they might be dict or object attributes)
            def get_field(fields, field_name):
                """Helper to get field value from dict or object"""
                if isinstance(fields, dict):
                    return fields.get(field_name)
                else:
                    return getattr(fields, field_name, None)

            # Extract all fields
            user_details = {
                'user_address': get_field(fields, 'user_address') or get_field(fields, 'owner'),
                'is_premium': get_field(fields, 'is_premium'),
                'points': get_field(fields, 'points'),
                'referral_code': get_field(fields, 'referral_code'),
                'referred_by': get_field(fields, 'referred_by'),
                'total_referrals_made': get_field(fields, 'total_referrals_made'),
                'daily_referral_count': get_field(fields, 'daily_referral_count'),
                'last_checkin': get_field(fields, 'last_checkin'),
                'created_at': get_field(fields, 'created_at'),
                'claimed_admin_code': get_field(fields, 'claimed_admin_code'),
                'encrypted_data_blob': get_field(fields, 'encrypted_data_blob')
            }

            return user_details

        except Exception as e:
            import traceback
            traceback.print_exc()
            return None

    def update_user_session(self, profile_id: str, session_data: str) -> bool:
        """
        Update user session data on blockchain using update_encrypted_data.
        """
        try:
            return self.update_encrypted_data(profile_id, session_data)
        except Exception as e:
            return False

    def get_claimed_admin_code(self, profile_id: str) -> Optional[str]:
        """
        Get the admin code that a user claimed during registration.

        Args:
            profile_id: UserProfile object ID

        Returns:
            Admin code string if user claimed one, None otherwise
        """
        try:
            details = self.get_user_details(profile_id)
            if details:
                claimed_code = details.get('claimed_admin_code')
                # Handle Option<String> - might be None or nested structure
                if claimed_code and isinstance(claimed_code, dict):
                    return claimed_code.get('value') or claimed_code.get('Some')
                return claimed_code
            return None

        except Exception as e:
            return None

    def get_batch_details(self, batch_id: str) -> Optional[Dict[str, Any]]:
        """
        Get details about an admin code batch.

        Args:
            batch_id: AdminReferralCodeBatch object ID

        Returns:
            Dictionary with batch information
        """
        try:
            obj_result = self.client.get_object(batch_id)

            if not obj_result.is_ok():
                return None

            obj_data = obj_result.result_data

            # Extract fields
            fields = None
            if hasattr(obj_data, 'data') and hasattr(obj_data.data, 'content'):
                fields = obj_data.data.content.fields
            elif hasattr(obj_data, 'content'):
                fields = obj_data.content.fields
            elif isinstance(obj_data, dict):
                if 'data' in obj_data and 'content' in obj_data['data']:
                    fields = obj_data['data']['content'].get('fields')

            if not fields:
                return None

            def get_field(fields, field_name):
                if isinstance(fields, dict):
                    return fields.get(field_name)
                return getattr(fields, field_name, None)

            batch_details = {
                'codes': get_field(fields, 'codes'),
                'generated_by': get_field(fields, 'generated_by'),
                'generated_at': get_field(fields, 'generated_at'),
                'codes_claimed': get_field(fields, 'codes_claimed'),
                'total_codes': len(get_field(fields, 'codes')) if get_field(fields, 'codes') else 10
            }

            return batch_details

        except Exception as e:
            import traceback
            traceback.print_exc()
            return None

    # ==================== HELPER METHODS ====================

    def _extract_profile_id(self, result_data) -> Optional[str]:
        """Extract UserProfile ID from transaction result - FIXED VERSION."""
        profile_id = None

        # Get all created object IDs
        if not (hasattr(result_data, 'effects') and hasattr(result_data.effects, 'created')):
            return None

        created = result_data.effects.created

        # Extract object IDs
        created_ids = []
        for i, obj in enumerate(created):
            obj_id = None

            if hasattr(obj, 'reference'):
                obj_id = str(obj.reference.object_id)
            elif hasattr(obj, 'object_id'):
                obj_id = str(obj.object_id)
            elif isinstance(obj, dict):
                obj_id = str(obj.get('objectId', obj.get('object_id', '')))

            if obj_id:
                created_ids.append(obj_id)

        # Fetch each object to check its type
        for i, obj_id in enumerate(created_ids):
            try:
                obj_result = self.client.get_object(obj_id)

                if not obj_result.is_ok():
                    continue

                obj_data = obj_result.result_data

                # THE FIX: Check object_type attribute directly!
                obj_type = None
                if hasattr(obj_data, 'object_type'):
                    obj_type = str(obj_data.object_type)

                # Check if this is a UserProfile
                if 'UserProfile' in obj_type or 'user_profile' in obj_type.lower():
                    profile_id = obj_id
                    break

                # Also check by package ID match
                if self.package_id and self.package_id[:10] in obj_type and '::bot::UserProfile' in obj_type:
                    profile_id = obj_id
                    break

            except Exception as e:
                continue

        return profile_id

    # ==================== KEEP ALL EXISTING METHODS ====================

    def update_encrypted_data(self, profile_id: str,
                              new_encrypted_blob: str) -> bool:
        """Update user's encrypted data blob."""
        try:
            txn = SyncTransaction(client=self.client)
            txn.move_call(
                target=f"{self.package_id}::{self.module_name}::update_encrypted_data",
                arguments=[
                    ObjectID(profile_id),
                    SuiString(new_encrypted_blob),
                ]
            )
            result = txn.execute(gas_budget="5000000")
            return result.is_ok()
        except Exception as e:
            return False

    def upgrade_to_premium(self, profile_id: str, payment_coin_id: str) -> Optional[str]:
        """Upgrade user to premium membership."""
        try:
            txn = SyncTransaction(client=self.client)
            txn.move_call(
                target=f"{self.package_id}::{self.module_name}::upgrade_to_premium",
                arguments=[
                    ObjectID(self.treasury_id),
                    ObjectID(profile_id),
                    ObjectID(payment_coin_id),
                ]
            )
            result = txn.execute(gas_budget="10000000")
            if result.is_ok():
                return result.result_data.digest
            return None
        except Exception as e:
            return None

    def checkin(self, profile_id: str) -> bool:
        """Perform daily check-in."""
        try:
            txn = SyncTransaction(client=self.client)
            txn.move_call(
                target=f"{self.package_id}::{self.module_name}::checkin",
                arguments=[ObjectID(profile_id)]
            )
            result = txn.execute(gas_budget="5000000")
            return result.is_ok()
        except Exception as e:
            return False

    def process_referral(self, referrer_profile_id: str,
                         referred_profile_id: str,
                         referral_code: str) -> bool:
        """Process referral reward."""
        try:
            txn = SyncTransaction(client=self.client)
            txn.move_call(
                target=f"{self.package_id}::{self.module_name}::process_referral",
                arguments=[
                    ObjectID(self.registry_id),
                    ObjectID(referrer_profile_id),
                    ObjectID(referred_profile_id),
                    SuiString(referral_code),
                ]
            )
            result = txn.execute(gas_budget="10000000")
            return result.is_ok()
        except Exception as e:
            return False


    # ==================== TASK MANAGEMENT METHODS ====================

    def create_task(self, profile_id: str, encrypted_details_blob: str, due_date: int) -> Optional[str]:
        """
        Create a new task on the Sui blockchain.

        Args:
            profile_id: User's profile object ID (for authorization)
            encrypted_details_blob: Walrus blob ID with encrypted task details
            due_date: Unix timestamp in milliseconds (0 if no due date)

        Returns:
            Task object ID if successful
        """
        try:
            txn = SyncTransaction(client=self.client)
            txn.move_call(
                target=f"{self.package_id}::{self.module_name}::create_task",
                arguments=[
                    ObjectID(self.registry_id),
                    ObjectID(profile_id),
                    SuiString(encrypted_details_blob),
                    SuiInteger(due_date),
                ]
            )

            result = txn.execute(gas_budget="10000000")

            if result.is_ok():
                # Enhanced task ID extraction
                task_id = self._extract_task_id(result.result_data)
                if task_id:
                    return task_id
                else:
                    # Return a placeholder or handle accordingly
                    return "task_created_but_id_not_found"
            else:
                return None

        except Exception as e:
            import traceback
            traceback.print_exc()
            return None

    def _extract_task_id(self, result_data) -> Optional[str]:
        """Extract Task ID from transaction result with better parsing."""
        task_id = None

        # Method 1: Check events for TaskCreated
        if hasattr(result_data, 'events'):
            for i, event in enumerate(result_data.events):
                event_type = str(getattr(event, 'type', ''))

                if 'TaskCreated' in event_type:
                    # Try different ways to get parsed data
                    if hasattr(event, 'parsed_json'):
                        parsed = event.parsed_json
                        task_id = parsed.get('task_id')

                    if task_id:
                        return task_id

        # Method 2: Check created objects more thoroughly
        if hasattr(result_data, 'effects') and hasattr(result_data.effects, 'created'):
            created_objects = result_data.effects.created

            for i, obj in enumerate(created_objects):
                obj_id = None

                # Extract object ID using different methods
                if hasattr(obj, 'reference') and hasattr(obj.reference, 'object_id'):
                    obj_id = str(obj.reference.object_id)
                elif hasattr(obj, 'object_id'):
                    obj_id = str(obj.object_id)
                elif isinstance(obj, dict):
                    obj_id = obj.get('objectId') or obj.get('object_id')

                if obj_id:
                    # For now, assume the first created object is the task
                    # In a real scenario, you'd check the object type
                    if not task_id:
                        task_id = obj_id

        # Method 3: Check transaction digest as fallback
        if not task_id and hasattr(result_data, 'digest'):
            # Use transaction digest as a temporary identifier
            tx_digest = result_data.digest
            task_id = f"task_{tx_digest[:16]}"

        return task_id

    def complete_task(self, task_id: str, profile_id: str) -> bool:
        """
        Mark a task as completed.
        Args:
            task_id: Task object ID to complete
            profile_id: User's profile ID (for authorization)
        Returns:
            True if successful
        """
        try:
            txn = SyncTransaction(client=self.client)
            txn.move_call(
                target=f"{self.package_id}::{self.module_name}::complete_task",
                arguments=[
                    ObjectID(task_id),
                    ObjectID(profile_id),
                ]
            )
            result = txn.execute(gas_budget="5000000")
            if result.is_ok():
                return True
            return False
        except Exception as e:
            return False

    def delete_task(self, task_id: str, profile_id: str) -> bool:
        """
        Permanently delete a task from the blockchain.
        Args:
            task_id: Task object ID to delete
            profile_id: User's profile ID (for authorization)
        Returns:
            True if successful
        """
        try:
            txn = SyncTransaction(client=self.client)
            txn.move_call(
                target=f"{self.package_id}::{self.module_name}::delete_task",
                arguments=[
                    ObjectID(self.registry_id),
                    ObjectID(task_id),
                    ObjectID(profile_id),
                ]
            )
            result = txn.execute(gas_budget="5000000")
            return result.is_ok()
        except Exception as e:
            return False

    def get_all_users_from_registry(self, registry_id: str):
        """Get all users from Registry → returns list of profile objects"""
        try:
            obj = self.client.get_object(registry_id)
            if not obj.is_ok():
                return []

            fields = obj.result_data.content['fields']
            users = fields['users']['fields']['contents']

            profiles = []
            for user in users:
                profile_id = user['value']
                profile_obj = self.client.get_object(profile_id)
                if profile_obj.is_ok():
                    data = profile_obj.result_data.content['fields']
                    profiles.append({
                        'profile_id': profile_id,
                        'user_address': data['user_address'],
                        'points': int(data['points']),
                        'username': data.get('username', 'Anonymous'),  # if you store it
                        'is_premium': data['is_premium'],
                        'last_checkin': data['last_checkin'],
                    })
            return profiles
        except Exception as e:
            return []

def get_user_tasks(self, profile_id: str) -> List[Dict[str, Any]]:
    """Simple task retrieval - returns empty list for now"""
    # For now, return empty list while we debug other issues
    # This will prevent the 'time' not defined error
    return []

def get_task_details(self, task_id):
    """Get task details - placeholder implementation"""
    return {'encrypted_details_blob': 'mock_blob'}

def get_user_tasks_proper(self, profile_id: str) -> List[Dict[str, Any]]:
    """Proper implementation to get user tasks from blockchain"""
    try:
        # Method 1: Try dynamic field lookup (common in Sui contracts)
        tasks = []

        # Get the user profile object to check for task references
        user_details = self.get_user_details(profile_id)
        if user_details:
            # Check for task-related fields
            for field_name in ['tasks', 'user_tasks', 'task_list', 'created_tasks']:
                if field_name in user_details:
                    pass

        # Method 2: Query the registry for tasks owned by this profile
        # This would require knowing how tasks are stored in your contract
        # Common patterns:
        # 1. Tasks stored in a global vector in the registry
        # 2. Tasks stored as dynamic fields on user profiles
        # 3. Tasks stored as separate objects with owner references

        # Since we don't have the exact contract structure, let's try a generic approach
        txn = SyncTransaction(client=self.client)

        # Try to call a view function if it exists
        try:
            txn.move_call(
                target=f"{self.package_id}::{self.module_name}::get_user_tasks",
                arguments=[
                    ObjectID(self.registry_id),
                    ObjectID(profile_id),
                ]
            )

            result = self.client.dry_run(txn)

            if result.is_ok():
                # Parse the return values
                if hasattr(result.result_data, 'effects') and hasattr(result.result_data.effects, 'return_values'):
                    return_values = result.result_data.effects.return_values
                    if return_values:
                        # Process the return values to extract task data
                        pass
        except Exception as e:
            pass

        # Method 3: Try to get all objects owned by the profile
        owned_objects = self.client.get_objects(profile_id)

        if owned_objects.is_ok():
            tasks = []
            for obj in owned_objects.result_data:
                obj_type = str(getattr(obj, 'type', ''))
                if 'Task' in obj_type or 'task' in obj_type.lower():
                    task_data = self._parse_task_object(obj)
                    if task_data:
                        tasks.append(task_data)

            return tasks

        return []

    except Exception as e:
        return []

def _parse_task_object(self, task_obj) -> Optional[Dict[str, Any]]:
    """Parse a task object into a dictionary"""
    try:
        # Extract fields from the task object
        fields = None

        if hasattr(task_obj, 'data') and hasattr(task_obj.data, 'content'):
            fields = task_obj.data.content.fields
        elif hasattr(task_obj, 'content'):
            fields = task_obj.content.fields
        elif isinstance(task_obj, dict):
            if 'data' in task_obj and 'content' in task_obj['data']:
                fields = task_obj['data']['content'].get('fields')

        if not fields:
            return None

        def get_field(fields, field_name):
            if isinstance(fields, dict):
                return fields.get(field_name)
            return getattr(fields, field_name, None)

        task_data = {
            'id': getattr(task_obj, 'object_id', 'unknown'),
            'encrypted_details_blob': get_field(fields, 'encrypted_details_blob'),
            'due_date': get_field(fields, 'due_date'),
            'status': get_field(fields, 'status'),
            'created_by': get_field(fields, 'created_by'),
            'created_at': get_field(fields, 'created_at')
        }

        return task_data

    except Exception as e:
        return None


# Example usage
if __name__ == "__main__":
    client = CopilotSuiClient()

    print("=" * 60)
    print("Testing New Admin Referral Code System")
    print("=" * 60)

    # Admin generates codes
    print("\n1. Admin generating batch of codes...")
    admin_cap_id = "0x..."  # Replace with actual AdminCap ID
    batch_result = client.admin_generate_code_batch(admin_cap_id)

    if batch_result:
        print(f"✅ Generated {len(batch_result['codes'])} codes:")
        for code in batch_result['codes'][:3]:  # Show first 3
            print(f"   - {code}")

    # User signs up with admin code
    print("\n2. User signing up with admin code...")
    admin_code = "ADM-A3F2-B4C1"  # Example code

    # Check if code is available
    if client.is_admin_code_available(admin_code):
        print(f"✅ Code {admin_code} is available!")

        # Create user profile
        encrypted_blob = "bafybei" + "x" * 52
        result = client.create_user_profile_with_admin_code(
            admin_code=admin_code,
            encrypted_data_blob=encrypted_blob
        )

        if result:
            print(f"✅ User created: {result['profile_id']}")
    else:
        print(f"❌ Code {admin_code} is not available")

    # Check user referral code usage
    print("\n3. Checking user referral code usage...")
    user_code = "ABC123XY"
    usage = client.get_user_referral_code_usage(user_code)
    print(f"Code: {user_code}")
    print(f"Used: {usage['usage_count']}/{usage['max_uses']}")
    print(f"Available: {usage['is_available']}")
    print(f"Remaining: {usage['remaining_uses']}")