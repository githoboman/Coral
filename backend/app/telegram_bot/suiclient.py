import json
import os
import logging
from datetime import datetime
import time
from pathlib import Path
from typing import Optional, Dict, Any, List
from pysui import SuiConfig, SyncClient
from pysui.sui.sui_types.scalars import ObjectID, SuiString, SuiInteger
from pysui.sui.sui_txn import SyncTransaction
from pysui.sui.sui_excepts import SuiFileNotFound
from dotenv import load_dotenv

load_dotenv()

logger = logging.getLogger(__name__)


class CopilotSuiClient:
    """
    Client for interacting with Copilot smart contract on Sui blockchain.

    UPDATED: Now supports admin-generated referral codes and enhanced referral system.
    """

    def __init__(self):
        # FIXED: Use custom config instead of default_config()
        try:
            # Try default config first (if Sui CLI is installed)
            self.config = SuiConfig.default_config()
            logger.info("✅ Using default Sui config from CLI")
        except SuiFileNotFound:
            # Fallback: Create custom config from environment variables
            logger.info(
                "⚠️ Sui CLI config not found, using custom config from .env")

            rpc_url = os.getenv(
                'SUI_RPC_URL', 'https://fullnode.testnet.sui.io:443')

            # Create user config with RPC URL
            self.config = SuiConfig.user_config(
                rpc_url=rpc_url,
                prv_keys=[],  # No private keys needed for read-only operations
            )
            logger.info(f"✅ Using custom config with RPC: {rpc_url}")

        # Override RPC URL if provided in environment (even if default config exists)
        if os.getenv('SUI_RPC_URL'):
            self.config._rpc_url = os.getenv('SUI_RPC_URL')
            logger.info(f"🔄 Overriding RPC URL: {self.config._rpc_url}")

        # Initialize client
        self.client = SyncClient(self.config)

        # Load contract addresses from environment
        self.package_id = os.getenv('COPILOT_PACKAGE_ID')
        self.registry_id = os.getenv('COPILOT_REGISTRY_ID')
        self.treasury_id = os.getenv('COPILOT_TREASURY_ID')
        self.module_name = "bot"

        # Validate required environment variables
        if not self.package_id:
            logger.warning("⚠️ COPILOT_PACKAGE_ID not set in .env")
        if not self.registry_id:
            logger.warning("⚠️ COPILOT_REGISTRY_ID not set in .env")

        logger.info(f"📦 Package ID: {self.package_id}")
        logger.info(f"📋 Registry ID: {self.registry_id}")

        # Constants
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

                logger.info(
                    f"Generated {len(codes)} admin codes in batch {batch_id}")

                return {
                    'tx_digest': tx_digest,
                    'batch_id': batch_id,
                    'codes': codes
                }

            logger.error(
                f"Failed to generate admin codes: {result.result_string}")
            return None

        except Exception as e:
            logger.error(f"Error generating admin codes: {e}")
            return None

    # ==================== USER PROFILE CREATION (3 METHODS) ====================

    def create_user_profile(self, encrypted_data_blob: str) -> Optional[Dict[str, str]]:
        """
        Create user profile WITHOUT any referral code.
        Enhanced with better profile ID extraction.
        """
        try:
            txn = SyncTransaction(client=self.client)

            txn.move_call(
                target=f"{self.package_id}::{self.module_name}::create_user_profile",
                arguments=[
                    ObjectID(self.registry_id),
                    SuiString(encrypted_data_blob),
                ]
            )

            result = txn.execute(gas_budget="10000000")

            if result.is_ok():
                tx_digest = result.result_data.digest

                # Enhanced profile ID extraction
                profile_id = self._extract_profile_id(result.result_data)

                if not profile_id:
                    logger.warning(
                        "⚠️ Could not extract profile ID, but transaction succeeded")
                    logger.info(
                        "You can find the profile ID by querying owned objects:")
                    logger.info(f"Transaction: {tx_digest}")

                    # Return with None profile_id but success status
                    return {
                        'tx_digest': tx_digest,
                        'profile_id': None,
                        'status': 'success_no_profile_id'
                    }

                logger.info(f"✅ User profile created: {profile_id}")
                return {
                    'tx_digest': tx_digest,
                    'profile_id': profile_id
                }

            logger.error(f"Transaction failed: {result.result_string}")
            return None

        except Exception as e:
            logger.error(f"Error creating user profile: {e}")
            import traceback
            traceback.print_exc()
            return None

    def create_user_profile_with_admin_code(self, admin_code: str,
                                            encrypted_data_blob: str) -> Optional[Dict[str, str]]:
        """
        Create user profile using an admin-generated referral code.
        Enhanced with better profile ID extraction.
        """
        try:
            txn = SyncTransaction(client=self.client)

            txn.move_call(
                target=f"{self.package_id}::{self.module_name}::create_user_profile_with_admin_code",
                arguments=[
                    ObjectID(self.registry_id),
                    SuiString(admin_code),
                    SuiString(encrypted_data_blob),
                ]
            )

            result = txn.execute(gas_budget="10000000")

            if result.is_ok():
                tx_digest = result.result_data.digest
                profile_id = self._extract_profile_id(result.result_data)

                if not profile_id:
                    logger.warning(
                        "⚠️ Could not extract profile ID, but transaction succeeded")
                    return {
                        'tx_digest': tx_digest,
                        'profile_id': None,
                        'admin_code_used': admin_code,
                        'status': 'success_no_profile_id'
                    }

                logger.info(
                    f"✅ User created with admin code {admin_code}: {profile_id}")
                return {
                    'tx_digest': tx_digest,
                    'profile_id': profile_id,
                    'admin_code_used': admin_code
                }

            logger.error(f"Transaction failed: {result.result_string}")
            return None

        except Exception as e:
            logger.error(f"Error creating user with admin code: {e}")
            import traceback
            traceback.print_exc()
            return None

    def create_user_profile_with_referral(self, referrer_code: str,
                                          encrypted_data_blob: str) -> Optional[Dict[str, str]]:
        """
        Create user profile using another user's referral code.
        Enhanced with better profile ID extraction.
        """
        try:
            txn = SyncTransaction(client=self.client)

            txn.move_call(
                target=f"{self.package_id}::{self.module_name}::create_user_profile_with_referral",
                arguments=[
                    ObjectID(self.registry_id),
                    SuiString(referrer_code),
                    SuiString(encrypted_data_blob),
                ]
            )

            result = txn.execute(gas_budget="10000000")

            if result.is_ok():
                tx_digest = result.result_data.digest
                profile_id = self._extract_profile_id(result.result_data)

                if not profile_id:
                    logger.warning(
                        "⚠️ Could not extract profile ID, but transaction succeeded")
                    return {
                        'tx_digest': tx_digest,
                        'profile_id': None,
                        'referrer_code': referrer_code,
                        'status': 'success_no_profile_id'
                    }

                logger.info(
                    f"✅ User created with referral {referrer_code}: {profile_id}")
                return {
                    'tx_digest': tx_digest,
                    'profile_id': profile_id,
                    'referrer_code': referrer_code
                }

            logger.error(f"Transaction failed: {result.result_string}")
            return None

        except Exception as e:
            logger.error(f"Error creating user with referral: {e}")
            import traceback
            traceback.print_exc()
            return None

    def find_profile_id_from_receipt(self, user_id: str) -> Optional[str]:
        """Find profile ID from registration receipt for a given user_id."""
        logger.debug(
            f"Searching for profile_id in receipts for user {user_id}")
        try:
            receipts_dir = Path('./registration_receipts')
            if not receipts_dir.exists():
                logger.warning(
                    f"Receipts directory does not exist for user {user_id}")
                return None

            for receipt_path in receipts_dir.glob(f"{user_id}_*.json"):
                try:
                    with open(receipt_path, 'r') as f:
                        receipt = json.load(f)
                        if receipt.get('telegram_id') == user_id and receipt.get('status') == 'blockchain':
                            profile_id = receipt.get('profile_id')
                            if profile_id:
                                logger.debug(
                                    f"Found profile_id {profile_id} in receipt {receipt_path} for user {user_id}")
                                return profile_id
                            else:
                                logger.info(
                                    f"Receipt {receipt_path} for user {user_id} has no profile_id (local_only mode)")
                except Exception as e:
                    logger.warning(
                        f"Error reading receipt {receipt_path}: {e}")
            logger.info(
                f"No valid profile_id found in receipts for user {user_id}")
            return None
        except Exception as e:
            logger.error(
                f"Error searching receipts for user {user_id}: {e}", exc_info=True)
            return None

    # ==================== TASK CREATION ====================
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
            logger.info(
                f"Creating task for profile {profile_id} with blob {encrypted_details_blob}")

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
                    logger.info(f"✅ Task created successfully: {task_id}")
                    return task_id
                else:
                    logger.warning(
                        "⚠️ Task creation succeeded but could not extract task ID")
                    # Return a placeholder or handle accordingly
                    return "task_created_but_id_not_found"
            else:
                logger.error(
                    f"❌ Failed to create task: {result.result_string}")
                return None

        except Exception as e:
            logger.error(f"❌ Error creating task: {e}")
            import traceback
            traceback.print_exc()
            return None

    def _extract_task_id(self, result_data) -> Optional[str]:
        """Extract Task ID from transaction result with better parsing."""
        task_id = None
        logger.info("🔍 Attempting to extract task ID from transaction...")

        # Method 1: Check events for TaskCreated
        if hasattr(result_data, 'events'):
            logger.info(f"Found {len(result_data.events)} events")
            for i, event in enumerate(result_data.events):
                event_type = str(getattr(event, 'type', ''))
                logger.info(f"Event {i}: {event_type}")

                if 'TaskCreated' in event_type:
                    # Try different ways to get parsed data
                    if hasattr(event, 'parsed_json'):
                        parsed = event.parsed_json
                        task_id = parsed.get('task_id')
                        logger.info(
                            f"Found task_id from parsed_json: {task_id}")
                    elif hasattr(event, 'bcs'):
                        # Try to parse bcs data
                        bcs_data = event.bcs
                        logger.info(f"BCS data: {bcs_data}")

                    if task_id:
                        return task_id

        # Method 2: Check created objects more thoroughly
        if hasattr(result_data, 'effects') and hasattr(result_data.effects, 'created'):
            created_objects = result_data.effects.created
            logger.info(f"Found {len(created_objects)} created objects")

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
                    logger.info(f"Created object {i}: {obj_id}")
                    # For now, assume the first created object is the task
                    # In a real scenario, you'd check the object type
                    if not task_id:
                        task_id = obj_id
                        logger.info(f"Using as task ID: {task_id}")

        # Method 3: Check transaction digest as fallback
        if not task_id and hasattr(result_data, 'digest'):
            # Use transaction digest as a temporary identifier
            tx_digest = result_data.digest
            task_id = f"task_{tx_digest[:16]}"
            logger.info(f"Using transaction digest as task ID: {task_id}")

        if task_id:
            logger.info(f"✅ Final task ID: {task_id}")
        else:
            logger.error("❌ Could not extract any task ID")

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
                logger.info(f"Task completed: {task_id}")
                return True
            return False
        except Exception as e:
            logger.error(f"Error completing task: {e}")
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
            logger.error(f"Error deleting task: {e}")
            return False

    def get_user_tasks(self, profile_id: str) -> List[Dict[str, Any]]:
        """Simple task retrieval - returns empty list for now"""
        logger.info(f"🔄 Getting tasks for profile: {profile_id}")

        # For now, return empty list while we debug other issues
        # This will prevent the 'time' not defined error
        return []

        # Alternative: Return mock data for testing
        # return [
        #     {
        #         'id': 'mock_task_1',
        #         'encrypted_details_blob': 'mock_blob_1',
        #         'due_date': None,
        #         'status': 'pending',
        #         'created_at': datetime.now()
        #     }
        # ]

    def get_task_details(self, task_id):
        return {'encrypted_details_blob': 'mock_blob'}

    def get_user_tasks_proper(self, profile_id: str) -> List[Dict[str, Any]]:
        """Proper implementation to get user tasks from blockchain"""
        logger.info(f"🔍 Fetching tasks for profile: {profile_id}")

        try:
            # Method 1: Try dynamic field lookup (common in Sui contracts)
            tasks = []

            # Get the user profile object to check for task references
            user_details = self.get_user_details(profile_id)
            if user_details:
                logger.info(
                    f"User profile fields: {list(user_details.keys())}")

                # Check for task-related fields
                for field_name in ['tasks', 'user_tasks', 'task_list', 'created_tasks']:
                    if field_name in user_details:
                        logger.info(
                            f"Found task field: {field_name} = {user_details[field_name]}")

            # Method 2: Query the registry for tasks owned by this profile
            logger.info("Querying registry for tasks...")

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
                    logger.info("get_user_tasks function exists and succeeded")
                    # Parse the return values
                    if hasattr(result.result_data, 'effects') and hasattr(result.result_data.effects, 'return_values'):
                        return_values = result.result_data.effects.return_values
                        if return_values:
                            logger.info(f"Return values: {return_values}")
                            # Process the return values to extract task data
                else:
                    logger.warning("get_user_tasks function call failed")

            except Exception as e:
                logger.warning(f"get_user_tasks function may not exist: {e}")

            # Method 3: Try to get all objects owned by the profile
            logger.info(f"Getting objects owned by profile {profile_id}")
            owned_objects = self.client.get_objects(profile_id)

            if owned_objects.is_ok():
                tasks = []
                for obj in owned_objects.result_data:
                    obj_type = str(getattr(obj, 'type', ''))
                    if 'Task' in obj_type or 'task' in obj_type.lower():
                        task_data = self._parse_task_object(obj)
                        if task_data:
                            tasks.append(task_data)

                logger.info(
                    f"Found {len(tasks)} task objects directly owned by profile")
                return tasks

            logger.warning("No tasks found with current methods")
            return []

        except Exception as e:
            logger.error(f"Error in get_user_tasks_proper: {e}")
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
            logger.error(f"Error parsing task object: {e}")
            return None

    # ==================== REFERRAL CODE CHECKING ====================

    def is_admin_code_available(self, admin_code: str) -> bool:
        """
        Check if an admin referral code exists and is available.
        """
        try:
            logger.info(f"🔍 Checking admin code: {admin_code}")

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
                logger.info(
                    f"✅ Transaction successful: {result.result_data.digest}")

                # Comprehensive debugging of the entire result structure
                self._debug_full_transaction_result(result.result_data)

                # Try multiple extraction strategies
                return self._extract_boolean_from_result(result.result_data)
            else:
                logger.error(f"❌ Transaction failed: {result.result_string}")
                return False

        except Exception as e:
            logger.error(f"❌ Error checking admin code: {e}")
            return False

    def _debug_full_transaction_result(self, result_data):
        """Comprehensive debug of the entire transaction result structure."""
        logger.info("=" * 60)
        logger.info("📊 FULL TRANSACTION RESULT DEBUG")
        logger.info("=" * 60)

        # Print all top-level attributes
        logger.info("Top-level attributes:")
        for attr in dir(result_data):
            if not attr.startswith('_'):
                value = getattr(result_data, attr, None)
                logger.info(f"  {attr}: {type(value)}")

        # Detailed effects analysis
        if hasattr(result_data, 'effects'):
            effects = result_data.effects
            logger.info("\n🔧 EFFECTS ANALYSIS:")
            logger.info(f"Effects type: {type(effects)}")

            # Print all effects attributes
            for attr in dir(effects):
                if not attr.startswith('_'):
                    value = getattr(effects, attr, None)
                    logger.info(f"  effects.{attr}: {value}")

            # Return values analysis
            if hasattr(effects, 'return_values'):
                return_values = effects.return_values
                logger.info(f"Return values: {return_values}")
                if return_values:
                    for i, rv in enumerate(return_values):
                        logger.info(f"  Return value {i}: {rv}")

            # Created objects analysis
            if hasattr(effects, 'created'):
                created = effects.created
                logger.info(f"Created objects count: {len(created)}")
                for i, obj in enumerate(created):
                    logger.info(f"  Created {i}: {obj}")
                    if hasattr(obj, 'object_type'):
                        logger.info(f"    Type: {obj.object_type}")
                    if hasattr(obj, 'object_id'):
                        logger.info(f"    ID: {obj.object_id}")

            # Mutated objects analysis
            if hasattr(effects, 'mutated'):
                mutated = effects.mutated
                logger.info(f"Mutated objects count: {len(mutated)}")
                for i, obj in enumerate(mutated):
                    logger.info(f"  Mutated {i}: {obj}")

        # Events analysis
        if hasattr(result_data, 'events'):
            events = result_data.events
            logger.info(f"\n📝 EVENTS ANALYSIS:")
            logger.info(f"Events count: {len(events)}")

            for i, event in enumerate(events):
                logger.info(f"  Event {i}:")
                logger.info(f"    Type: {type(event)}")

                # Print all event attributes
                for attr in dir(event):
                    if not attr.startswith('_'):
                        value = getattr(event, attr, None)
                        if attr == 'parsed_json' and value:
                            logger.info(f"    {attr}: {value}")
                        elif attr != 'parsed_json':
                            logger.info(f"    {attr}: {value}")

        logger.info("=" * 60)

    def _extract_boolean_from_result(self, result_data) -> bool:
        """Try multiple strategies to extract boolean result."""
        logger.info("🔄 Attempting to extract boolean result...")

        # Strategy 1: Effects return_values (most common)
        if hasattr(result_data, 'effects'):
            effects = result_data.effects
            if hasattr(effects, 'return_values') and effects.return_values:
                return_values = effects.return_values
                logger.info(f"Found return_values: {return_values}")

                if return_values and len(return_values) > 0:
                    # Handle nested structure: [[value]]
                    first_return = return_values[0]
                    if isinstance(first_return, (list, tuple)) and len(first_return) > 0:
                        value = first_return[0]
                        logger.info(
                            f"Extracted from return_values[0][0]: {value}")
                        return bool(value)
                    else:
                        # Flat structure: [value]
                        value = first_return
                        logger.info(
                            f"Extracted from return_values[0]: {value}")
                        return bool(value)

        # Strategy 2: Check for specific events
        if hasattr(result_data, 'events'):
            for event in result_data.events:
                event_type = str(getattr(event, 'type', ''))
                logger.info(f"Checking event type: {event_type}")

                # Look for parsed JSON data
                if hasattr(event, 'parsed_json'):
                    parsed = event.parsed_json
                    logger.info(f"Event parsed_json: {parsed}")

                    # Check common boolean field names
                    for field in ['available', 'is_available', 'result', 'success', 'exists', 'valid']:
                        if field in parsed:
                            value = parsed[field]
                            logger.info(f"Found field '{field}': {value}")
                            return bool(value)

                # Check bcs data if available
                if hasattr(event, 'bcs'):
                    bcs_data = event.bcs
                    logger.info(f"Event bcs data: {bcs_data}")

        # Strategy 3: Check created objects for result indicators
        if hasattr(result_data, 'effects') and hasattr(result_data.effects, 'created'):
            for obj in result_data.effects.created:
                obj_type = str(getattr(obj, 'object_type', ''))
                logger.info(f"Created object type: {obj_type}")

                # If a result object was created, we might need to fetch its data
                if any(keyword in obj_type.lower() for keyword in ['result', 'response', 'answer']):
                    logger.info(f"Potential result object found: {obj_type}")
                    # We would need to fetch this object's data to get the actual result
                    return True  # or False based on the object type

        # Strategy 4: Check transaction digest pattern
        # Sometimes the result might be indicated by the presence/absence of certain objects

        logger.warning("❌ Could not extract boolean result from any location")
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
            logger.error(f"Error getting admin code status: {e}")
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
            logger.error(f"Error getting referral usage: {e}")
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
            logger.error(f"Error checking referral availability: {e}")
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
            logger.info(f"Fetching user profile object: {profile_id}")

            obj_result = self.client.get_object(profile_id)

            if not obj_result.is_ok():
                logger.error(
                    f"Failed to get object: {obj_result.result_string}")
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
                logger.error("Could not extract fields from object")
                logger.info(f"Object data structure: {type(obj_data)}")
                if hasattr(obj_data, '__dict__'):
                    logger.info(
                        f"Object attributes: {obj_data.__dict__.keys()}")
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

            logger.info(f"✅ Successfully retrieved user details")
            return user_details

        except Exception as e:
            logger.error(f"Error getting user details: {e}")
            import traceback
            traceback.print_exc()
            return None

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
            logger.error(f"Error getting claimed admin code: {e}")
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
            logger.info(f"Fetching batch object: {batch_id}")

            obj_result = self.client.get_object(batch_id)

            if not obj_result.is_ok():
                logger.error(
                    f"Failed to get batch object: {obj_result.result_string}")
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
                logger.error("Could not extract batch fields")
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

            logger.info(f"✅ Successfully retrieved batch details")
            return batch_details

        except Exception as e:
            logger.error(f"Error getting batch details: {e}")
            import traceback
            traceback.print_exc()
            return None

    # ==================== HELPER METHODS ====================

    def _extract_profile_id(self, result_data) -> Optional[str]:
        """Extract UserProfile ID from transaction result - FIXED VERSION."""
        profile_id = None

        logger.info("🔍 Attempting to extract profile ID...")

        # Get all created object IDs
        if not (hasattr(result_data, 'effects') and hasattr(result_data.effects, 'created')):
            logger.error("No created objects in transaction")
            return None

        created = result_data.effects.created
        logger.info(f"Found {len(created)} created objects")

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
                logger.info(f"  Object {i + 1}: {obj_id}")

        # Fetch each object to check its type
        logger.info(f"\n🔎 Checking types of {len(created_ids)} objects...")

        for i, obj_id in enumerate(created_ids):
            try:
                logger.info(f"  Fetching object {i + 1}/{len(created_ids)}...")
                obj_result = self.client.get_object(obj_id)

                if not obj_result.is_ok():
                    logger.warning(
                        f"    Failed to fetch: {obj_result.result_string}")
                    continue

                obj_data = obj_result.result_data

                # THE FIX: Check object_type attribute directly!
                obj_type = None
                if hasattr(obj_data, 'object_type'):
                    obj_type = str(obj_data.object_type)
                    logger.info(f"    Type: {obj_type}")
                else:
                    logger.warning(f"    No object_type attribute")
                    continue

                # Check if this is a UserProfile
                if 'UserProfile' in obj_type or 'user_profile' in obj_type.lower():
                    profile_id = obj_id
                    logger.info(f"✅ Found UserProfile: {profile_id}")
                    break

                # Also check by package ID match
                if self.package_id and self.package_id[:10] in obj_type and '::bot::UserProfile' in obj_type:
                    profile_id = obj_id
                    logger.info(
                        f"✅ Found UserProfile via package match: {profile_id}")
                    break

            except Exception as e:
                logger.warning(f"    Error checking object: {e}")
                continue

        if profile_id:
            logger.info(f"\n✅ Final profile ID: {profile_id}")
        else:
            logger.error("\n❌ Could not find UserProfile in transaction")
            logger.info("Created objects were:")
            for obj_id in created_ids:
                logger.info(f"  - {obj_id}")

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
            logger.error(f"Error updating encrypted data: {e}")
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
                logger.info(f"User upgraded to premium: {profile_id}")
                return result.result_data.digest
            return None
        except Exception as e:
            logger.error(f"Error upgrading to premium: {e}")
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
            logger.error(f"Error during check-in: {e}")
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
            logger.error(f"Error processing referral: {e}")
            return False

    # ... (All other existing methods remain the same)


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
