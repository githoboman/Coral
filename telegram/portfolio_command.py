from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.ext import ContextTypes, CommandHandler, MessageHandler, ConversationHandler, filters, \
    CallbackQueryHandler
import requests
import os
from dotenv import load_dotenv
import re
import time
import urllib.parse
import asyncio
from functools import lru_cache
from datetime import datetime, timedelta
import pytz
from secure_storage import load_user_checkin_data, save_user_checkin_data
from utils import load_user_session, save_user_session

load_dotenv()

# Portfolio points configuration
PORTFOLIO_POINTS_DAILY = 4
PORTFOLIO_COOLDOWN_HOURS = 24

# Enhanced network configurations with more RPCs
NETWORKS = {
    'mainnet': {
        'name': '🌐 Mainnet',
        'rpc_urls': [
            'https://fullnode.mainnet.sui.io:443',
            'https://mainnet.suiet.app',
            'https://rpc-mainnet.suiscan.xyz',
            'https://mainnet.sui.rpcpool.com',
            'https://sui-mainnet.nodeinfra.com',
            'https://mainnet-rpc.sui.chainbase.online',
            'https://sui-mainnet-ca-1.cosmostation.io',
            'https://sui-mainnet-ca-2.cosmostation.io',
            'https://sui-mainnet-us-1.cosmostation.io',
            'https://sui-mainnet-us-2.cosmostation.io',
            "https://sui-mainnet-endpoint.blockvision.org",
            "https://sui-rpc.publicnode.com",
            "https://rpc.ankr.com/sui",
            "https://sui-mainnet-rpc.nodereal.io",
            "https://sui-mainnet-rpc-germany.allthatnode.com",
            "https://sui-mainnet-rpc.bwarelabs.com",
            "https://sui.publicnode.com",
        ],
        'explorer_url': 'https://suiscan.xyz/mainnet/',
        'explorer_name': 'SuiScan',
        'color': '🔵',
        'priority_rpcs': [
            'https://fullnode.mainnet.sui.io:443',
            'https://mainnet.suiet.app',
            'https://rpc-mainnet.suiscan.xyz',
            'https://sui-rpc.publicnode.com',
        ]
    },
    'testnet': {
        'name': '🧪 Testnet',
        'rpc_urls': [
            "https://fullnode.testnet.sui.io:443",
            "https://sui-testnet-endpoint.blockvision.org",
            "https://rpc.ankr.com/sui_testnet",
            "https://sui-testnet.publicnode.com",
            "https://sui-testnet-rpc.nodereal.io",
            "https://sui-testnet-rpc-germany.allthatnode.com",
        ],
        'explorer_url': 'https://suiscan.xyz/testnet/',
        'explorer_name': 'SuiScan Testnet',
        'color': '🟢'
    }
}

# Network detection patterns
TESTNET_PREFIXES = [
    '0x1', '0x2', '0x3', '0x4', '0x5', '0x6', '0x7', '0x8', '0x9',
    '0xa', '0xb', '0xc', '0xd', '0xe', '0xf'
]

ENTER_ADDRESS, SHOW_PORTFOLIO = range(2)
REQUEST_TIMEOUT = 10
PORTFOLIO_CACHE_TIMEOUT = 120


def get_sui_rpc_urls_for_network(network: str) -> list:
    """Get RPC URLs for specified network."""
    return NETWORKS.get(network, {}).get('rpc_urls', NETWORKS['mainnet']['rpc_urls'])


def detect_network_from_address(address: str) -> str:
    """Detect network based on address pattern."""
    address_lower = address.lower()
    if any(address_lower.startswith(prefix) for prefix in TESTNET_PREFIXES):
        return 'testnet'
    return 'mainnet'


def get_network_display_info(network: str) -> dict:
    """Get display information for a network."""
    return NETWORKS.get(network, NETWORKS['mainnet'])


async def sui_rpc_call(payload: dict, network: str = 'mainnet', retries: int = 3):  # Increased retries
    """Make RPC call to specified network with priority routing."""
    network_config = NETWORKS.get(network, NETWORKS['mainnet'])

    # Use priority RPCs first if available
    urls = network_config.get('priority_rpcs', []) + network_config['rpc_urls']


    seen = set()
    unique_urls = []
    for url in urls:
        if url not in seen:
            seen.add(url)
            unique_urls.append(url)

    for url in unique_urls:
        parsed = urllib.parse.urlparse(url)
        if not parsed.scheme or not parsed.netloc:
            continue

        for attempt in range(retries):
            try:
                response = await asyncio.get_event_loop().run_in_executor(
                    None, lambda: requests.post(url, json=payload, timeout=REQUEST_TIMEOUT)
                )
                response.raise_for_status()
                result = response.json()

                if 'error' in result:
                    continue

                return result

            except requests.exceptions.Timeout:
                if attempt < retries - 1:
                    await asyncio.sleep(1 * (attempt + 1))  # Exponential backoff

            except Exception:
                if attempt < retries - 1:
                    await asyncio.sleep(1 * (attempt + 1))  # Exponential backoff

    raise Exception(f"All {network.upper()} RPC endpoints failed after {retries} retries each.")


async def get_kiosk_listings(address: str, network: str):
    """Get kiosk listings with enhanced RPC support."""
    try:
        # First get all kiosk objects
        kiosk_payload = {
            "jsonrpc": "2.0",
            "id": 1,
            "method": "suix_getOwnedObjects",
            "params": [
                address,
                {
                    "filter": {
                        "StructType": "0x2::kiosk::Kiosk"
                    },
                    "options": {
                        "showContent": True
                    }
                },
                None,
                50
            ]
        }

        kiosk_result = await sui_rpc_call(kiosk_payload, network=network)
        if 'error' in kiosk_result:
            return 0, []

        kiosk_objects = kiosk_result.get('result', {}).get('data', [])
        kiosk_ids = [obj['data']['objectId'] for obj in kiosk_objects if obj.get('data')]

        if not kiosk_ids:
            return 0, []

        listed_items = 0
        all_listings = []

        # Get detailed kiosk information for each kiosk
        for kiosk_id in kiosk_ids[:5]:  # Limit to first 5 kiosks to avoid rate limits
            try:
                kiosk_detail_payload = {
                    "jsonrpc": "2.0",
                    "id": 1,
                    "method": "suix_getDynamicFieldObject",
                    "params": [kiosk_id, {"type": "0x2::kiosk::Listing", "name": {"type": "address"}}]
                }

                kiosk_detail_result = await sui_rpc_call(kiosk_detail_payload, network=network)
                if 'error' not in kiosk_detail_result and kiosk_detail_result.get('result'):
                    listed_items += 1
                    all_listings.append(kiosk_id)

            except Exception:
                continue

        return listed_items, kiosk_ids

    except Exception:
        return 0, []


def escape_html(text: str) -> str:
    """Escape <, >, & for HTML safety."""
    if not isinstance(text, str):
        text = str(text)
    return text.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')


TOKEN_NAME_MAP = {
    'sui::sui': 'SUI Token',
    'usdc::usdc': 'USDC Stablecoin',
    'usdt::usdt': 'USDT Stablecoin',
    'maga::maga': 'MAGA Memecoin',
    'rizz::rizz': 'RIZZ Memecoin',
    'wal::wal': 'WAL Memecoin',
}

TOKEN_NAME_CACHE = {}


def get_token_display_name(symbol: str) -> str:
    symbol_lower = symbol.lower()
    if symbol_lower in TOKEN_NAME_CACHE:
        return TOKEN_NAME_CACHE[symbol_lower]
    common_names = {
        'blub': 'Blub Memecoin',
        'deep': 'DeepBook Token',
        'usdc': 'USDC Stablecoin',
        'usdt': 'USDT Stablecoin',
        'celo': 'Celo USD',
        'weth': 'Wrapped ETH',
    }
    if symbol_lower in common_names:
        name = common_names[symbol_lower]
        TOKEN_NAME_CACHE[symbol_lower] = name
        return name
    name = f"{symbol.upper()} Token"
    TOKEN_NAME_CACHE[symbol_lower] = name
    return name


def get_friendly_name(obj_type: str, display_data: dict) -> str:
    type_lower = obj_type.lower()
    if 'coin' in type_lower:
        match = re.search(r'<([^>]+::[^>]+::)(\w+)>', obj_type)
        if match:
            key = f"{match.group(1)}{match.group(2)}".lower()
            symbol = match.group(2)
            if key in TOKEN_NAME_MAP:
                return TOKEN_NAME_MAP[key]
            return get_token_display_name(symbol)
        return "Unknown Token"
    if display_data and 'name' in display_data and display_data['name'].strip() and display_data['name'] != 'None':
        return display_data['name']
    parts = obj_type.split('::')
    if len(parts) >= 3:
        clean = parts[-1].replace('Coin', '').replace('>', '').strip()
        return f"{clean} Asset" if clean else "Asset"
    return "Asset"


def get_item_value(obj_data: dict, sui_price: float) -> str:
    content = obj_data.get('content', {}) or {}
    fields = content.get('fields', {}) or {}
    obj_type = content.get('type', '') or ''
    if 'Coin' in obj_type:
        balance = fields.get('balance', 0)
        if balance:
            amount = int(balance) / 1_000_000_000
            formatted = "{:,.2f}".format(amount)
            if 'sui::sui' in obj_type.lower():
                usd = amount * sui_price
                return f"{formatted} SUI (~${usd:,.2f} USD)" if sui_price else formatted
            return f"{formatted} units"
    if 'nft' in obj_type.lower():
        return "Collectible (NFT)"
    return "Value: Unknown"


@lru_cache(maxsize=1)
def get_sui_price_usd_cached(_: int = 0) -> float:
    """Cache SUI price for 10 minutes."""
    try:
        response = requests.get("https://api.coingecko.com/api/v3/simple/price?ids=sui&vs_currencies=usd", timeout=10)
        response.raise_for_status()
        price = response.json().get('sui', {}).get('usd', 0.0)
        return price
    except Exception:
        return 0.0


def get_sui_price_usd(context: ContextTypes.DEFAULT_TYPE) -> float:
    """Wrapper to handle cache expiration."""
    current_time = int(time.time())
    cache_info = context.user_data.get('sui_price_cache_time', 0)
    if current_time - cache_info > 600:  # 10 minutes
        context.user_data['sui_price_cache_time'] = current_time
        get_sui_price_usd_cached.cache_clear()
        return get_sui_price_usd_cached(current_time)
    return get_sui_price_usd_cached(current_time)


async def can_earn_portfolio_points(user_id: str, context: ContextTypes.DEFAULT_TYPE) -> tuple:
    """
    Check if user can earn portfolio points today.
    Returns: (can_earn: bool, last_portfolio_time: datetime, next_available: datetime)
    """
    try:
        session = await load_user_session(user_id, context)
        if not session:
            return True, None, None

        password = session.get('password')
        now_utc = datetime.now(pytz.UTC)

        # Check encrypted portfolio data first
        if password:
            try:
                portfolio_data = load_user_checkin_data(user_id + "_portfolio", password)
                last_portfolio_str = portfolio_data.get('last_portfolio_time')
                if last_portfolio_str:
                    last_portfolio = datetime.fromisoformat(last_portfolio_str.replace('Z', '+00:00'))
                    time_since_last = now_utc - last_portfolio
                    if time_since_last < timedelta(hours=PORTFOLIO_COOLDOWN_HOURS):
                        next_available = last_portfolio + timedelta(hours=PORTFOLIO_COOLDOWN_HOURS)
                        return False, last_portfolio, next_available
            except Exception:
                pass

        # Check session data as fallback
        last_portfolio_str = session.get('last_portfolio_time')
        if last_portfolio_str:
            try:
                last_portfolio = datetime.fromisoformat(last_portfolio_str.replace('Z', '+00:00'))
                time_since_last = now_utc - last_portfolio
                if time_since_last < timedelta(hours=PORTFOLIO_COOLDOWN_HOURS):
                    next_available = last_portfolio + timedelta(hours=PORTFOLIO_COOLDOWN_HOURS)
                    return False, last_portfolio, next_available
            except Exception:
                pass

        return True, None, None

    except Exception:
        return True, None, None


async def award_portfolio_points(user_id: str, context: ContextTypes.DEFAULT_TYPE) -> bool:
    """
    Award 4 points for portfolio check and update all data stores.
    Returns: True if points were awarded successfully
    """
    try:
        session = await load_user_session(user_id, context)
        if not session:
            return False

        password = session.get('password')
        now_utc = datetime.now(pytz.UTC)

        # Update session with points and timestamp
        current_points = session.get('points', 0)
        session['points'] = current_points + PORTFOLIO_POINTS_DAILY
        session['last_portfolio_time'] = now_utc.isoformat()
        session['portfolio_checkins'] = session.get('portfolio_checkins', 0) + 1

        # Save updated session
        await save_user_session(user_id, session)

        # Update encrypted portfolio data
        if password:
            try:
                portfolio_data = load_user_checkin_data(user_id + "_portfolio", password)
            except:
                portfolio_data = {"portfolio_checkins": [], "total_portfolio_points": 0}

            portfolio_entry = {
                'timestamp': int(now_utc.timestamp() * 1000),
                'date': now_utc.strftime("%Y-%m-%d"),
                'points_earned': PORTFOLIO_POINTS_DAILY
            }

            portfolio_data['portfolio_checkins'].append(portfolio_entry)
            portfolio_data['total_portfolio_points'] = portfolio_data.get('total_portfolio_points',
                                                                          0) + PORTFOLIO_POINTS_DAILY
            portfolio_data['last_portfolio_time'] = now_utc.isoformat()

            save_user_checkin_data(user_id + "_portfolio", password, portfolio_data)

        return True

    except Exception:
        return False


async def portfolio_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user_id = str(update.effective_user.id)

    # Clear any previous data
    context.user_data.clear()

    # Check if user can earn points
    can_earn, last_time, next_available = await can_earn_portfolio_points(user_id, context)

    if not can_earn and next_available:
        time_remaining = next_available - datetime.now(pytz.UTC)
        total_seconds = int(time_remaining.total_seconds())
        hours, remainder = divmod(total_seconds, 3600)
        minutes, seconds = divmod(remainder, 60)

        countdown = []
        if hours > 0:
            countdown.append(f"{hours} hour{'s' if hours != 1 else ''}")
        if minutes > 0:
            countdown.append(f"{minutes} minute{'s' if minutes != 1 else ''}")
        if seconds > 0 or (hours == 0 and minutes == 0):
            countdown.append(f"{seconds} second{'s' if seconds != 1 else ''}")
        countdown_str = ", ".join(countdown)

        points_msg = (
            f"⏰ **Portfolio Points Cooldown**\n\n"
            f"You've already earned your daily portfolio points!\n\n"
            f"🔄 **Next {PORTFOLIO_POINTS_DAILY} points available in:** {countdown_str}\n\n"
            f"💡 You can still check portfolios, but points are awarded once per {PORTFOLIO_COOLDOWN_HOURS} hours."
        )
        await update.message.reply_text(points_msg, parse_mode='Markdown')
    else:
        points_msg = (
            f"🎯 **Daily Portfolio Reward Available!**\n\n"
            f"Earn **{PORTFOLIO_POINTS_DAILY} points** for checking your portfolio!\n\n"
            f"⭐ **Limit:** Once every {PORTFOLIO_COOLDOWN_HOURS} hours\n"
            f"💎 **Multiple wallets:** Still only {PORTFOLIO_POINTS_DAILY} points total per day"
        )
        await update.message.reply_text(points_msg, parse_mode='Markdown')

    keyboard = [
        [
            InlineKeyboardButton("🌐 Mainnet", callback_data='network_mainnet'),
            InlineKeyboardButton("🧪 Testnet", callback_data='network_testnet')
        ],
        [InlineKeyboardButton("🔍 Auto-Detect", callback_data='network_auto')],
        [InlineKeyboardButton("❌ Cancel", callback_data='cancel_portfolio')]
    ]
    reply_markup = InlineKeyboardMarkup(keyboard)

    await update.message.reply_text(
        "🔮 **Select Network**\n\n"
        "Choose how to view your portfolio:\n\n"
        "🌐 Mainnet - Real assets & value\n"
        "🧪 Testnet - Test tokens & NFTs\n"
        "🔍 Auto-Detect - Smart network detection\n\n"
        "Or simply enter your Sui address:\n\n"
        "💡 *You can type /cancel anytime to exit*",
        reply_markup=reply_markup,
        parse_mode='Markdown'
    )
    return ENTER_ADDRESS


async def handle_network_selection(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Handle network selection callback."""
    query = update.callback_query
    await query.answer()

    user_id = str(query.from_user.id)
    data = query.data

    if data == 'network_auto':
        context.user_data['selected_network'] = 'auto'
        # Show address prompt with cancel button
        keyboard = [[InlineKeyboardButton("❌ Cancel", callback_data='cancel_portfolio')]]
        reply_markup = InlineKeyboardMarkup(keyboard)

        await query.edit_message_text(
            "🔍 **Auto-Detect Mode**\n\n"
            "I'll automatically detect the network based on your address format.\n\n"
            "Please enter your Sui address (e.g., 0x123...):\n\n"
            "💡 *Type /cancel to exit*",
            parse_mode='Markdown',
            reply_markup=reply_markup
        )
    else:
        network = data.replace('network_', '')
        context.user_data['selected_network'] = network
        network_info = get_network_display_info(network)

        # Show address prompt with cancel button
        keyboard = [[InlineKeyboardButton("❌ Cancel", callback_data='cancel_portfolio')]]
        reply_markup = InlineKeyboardMarkup(keyboard)

        await query.edit_message_text(
            f"{network_info['color']} **{network_info['name']} Selected**\n\n"
            f"You're now viewing the {network.upper()} network.\n\n"
            "Please enter your Sui address (e.g., 0x123...):\n\n"
            "💡 *Type /cancel to exit*",
            parse_mode='Markdown',
            reply_markup=reply_markup
        )

    return ENTER_ADDRESS


async def enter_address(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user_id = str(update.effective_user.id)
    address = update.message.text.strip()

    if not re.match(r'^0x[0-9a-fA-F]{64}$', address):
        await update.message.reply_text(
            "❌ **Invalid Sui Address**\n\n"
            "It must be 0x followed by 64 hex characters.\n\n"
            "Please try again:",
            parse_mode='Markdown'
        )
        return ENTER_ADDRESS

    try:
        context.user_data['sui_address'] = address
        context.user_data['objects_cursor'] = None
        context.user_data['current_page'] = 1
        context.user_data['portfolio_cache'] = None

        # Determine network
        selected_network = context.user_data.get('selected_network', 'auto')
        if selected_network == 'auto':
            detected_network = detect_network_from_address(address)
            context.user_data['current_network'] = detected_network
            network_info = get_network_display_info(detected_network)
            await update.message.reply_text(
                f"🔍 **Auto-Detected Network: {network_info['name']}**\n"
                f"Scanning your portfolio...",
                parse_mode='Markdown'
            )
        else:
            context.user_data['current_network'] = selected_network
            network_info = get_network_display_info(selected_network)
            await update.message.reply_text(
                f"{network_info['color']} **Using {network_info['name']}**\n"
                f"Scanning your portfolio...",
                parse_mode='Markdown'
            )

        # Award points if eligible (only once per day)
        can_earn, _, _ = await can_earn_portfolio_points(user_id, context)
        points_awarded = False

        if can_earn:
            points_awarded = await award_portfolio_points(user_id, context)

        await show_portfolio_page(update, context, points_awarded)
        return SHOW_PORTFOLIO

    except Exception:
        await update.message.reply_text(
            "❌ **Error Processing Address**\n\n"
            "Sorry, I couldn't process that address right now.\n\n"
            "Please try again or use /portfolio to restart.",
            parse_mode='Markdown'
        )
        return ConversationHandler.END


async def get_testnet_token_price(symbol: str, total_supply: float = None):
    """Get price for a token based on symbol and estimated supply."""
    known_prices = {
        'PEACE': 0.001, 'WAR': 0.001, 'CARL': 0.002, 'MALPRENET': 0.005,
        'MOON': 0.01, 'GNFSHS': 0.1, 'TRAM_TOKEN': 0.05, 'SUI': 1.0,
        'USDC': 1.0, 'USDT': 1.0, 'WETH': 1000.0, 'BTC': 50000.0, 'ETH': 3000.0
    }

    if symbol in known_prices:
        return known_prices[symbol]

    # Smart defaults based on common patterns
    symbol_lower = symbol.lower()

    if any(stable in symbol_lower for stable in ['usdc', 'usdt', 'dai', 'busd', 'ust']):
        return 1.0  # Stablecoins ~1 SUI

    if any(btc in symbol_lower for btc in ['btc', 'bitcoin']):
        return 50000.0  # Bitcoin derivatives

    if any(eth in symbol_lower for eth in ['eth', 'ethereum', 'weth']):
        return 3000.0  # Ethereum derivatives

    if any(memecoin in symbol_lower for memecoin in ['dog', 'cat', 'meme', 'pepe', 'shib']):
        return 0.0001  # Memecoins very low value

    # Default based on typical testnet token distribution
    return 0.001

async def show_portfolio_page(update: Update, context: ContextTypes.DEFAULT_TYPE, points_awarded: bool = False,
                              cursor: str = None):
    """Fetch and display portfolio with high-importance items."""
    address = context.user_data.get('sui_address')
    network = context.user_data.get('current_network', 'mainnet')

    if not address:
        await update.message.reply_text("No address found. Start with /portfolio.")
        return SHOW_PORTFOLIO

    network_info = get_network_display_info(network)
    cache = context.user_data.get('portfolio_cache')
    cache_time = context.user_data.get('portfolio_cache_time', 0)

    if cache and time.time() - cache_time < PORTFOLIO_CACHE_TIMEOUT and cursor is None:
        message, reply_markup = cache

        # Add points notification if awarded
        if points_awarded:
            points_header = (
                f"<b>🎉 +{PORTFOLIO_POINTS_DAILY} Points Awarded!</b>\n"
                f"You earned {PORTFOLIO_POINTS_DAILY} points for checking your portfolio today.\n\n"
            )
            message = points_header + message

        messages = split_message(message)
        for i, msg_chunk in enumerate(messages):
            if i == 0:
                if update.callback_query:
                    await update.callback_query.edit_message_text(msg_chunk, parse_mode='HTML',
                                                                  reply_markup=reply_markup)
                else:
                    await update.message.reply_text(msg_chunk, parse_mode='HTML', reply_markup=reply_markup)
            else:
                target = update.callback_query.message if update.callback_query else update.message
                await target.reply_text(msg_chunk, parse_mode='HTML')
        return SHOW_PORTFOLIO

    try:
        # Fetch all data in parallel
        balances_payload = {"jsonrpc": "2.0", "id": 1, "method": "suix_getAllBalances", "params": [address]}
        objects_payload = {
            "jsonrpc": "2.0", "id": 1,
            "method": "suix_getOwnedObjects",
            "params": [
                address,
                {
                    "filter": None,
                    "options": {
                        "showType": True,
                        "showDisplay": True,
                        "showContent": True
                    }
                },
                cursor,
                50
            ]
        }
        stakes_payload = {"jsonrpc": "2.0", "id": 1, "method": "suix_getStakes", "params": [address]}

        balances_result, objects_result, stakes_result = await asyncio.gather(
            sui_rpc_call(balances_payload, network=network),
            sui_rpc_call(objects_payload, network=network),
            sui_rpc_call(stakes_payload, network=network),
            return_exceptions=True
        )

        # Process balances
        if isinstance(balances_result, Exception) or 'error' in balances_result:
            full_balances = []
        else:
            full_balances = balances_result.get('result', [])

        # Process objects
        if isinstance(objects_result, Exception) or 'error' in objects_result:
            owned_objects = {}
            objects_data = []
        else:
            owned_objects = objects_result.get('result', {})
            objects_data = owned_objects.get('data', [])

        # Process stakes
        if isinstance(stakes_result, Exception) or 'error' in stakes_result:
            stakes_data = []
        else:
            stakes_data = stakes_result.get('result', [])

        # Get kiosk data
        listed_items, kiosk_ids = await get_kiosk_listings(address, network)

        # Calculate SUI balance and value
        sui_price = get_sui_price_usd(context) if network == 'mainnet' else 0.0
        sui_balance = 0
        total_token_value = 0

        # Process all balances to calculate total value
        for balance in full_balances:
            coin_type = balance['coinType']
            balance_amount = int(balance['totalBalance']) / 1_000_000_000

            if '::sui::SUI' in coin_type:
                sui_balance = balance_amount
                if network == 'mainnet':
                    total_token_value += balance_amount * sui_price
            elif network == 'mainnet':
                # For other tokens, we could add their value if we have price data
                total_token_value += balance_amount * 0  # Placeholder for other token values

        sui_value_usd = sui_balance * sui_price if network == 'mainnet' else 0

        # Calculate staking values
        total_staked = 0
        total_rewards = 0
        for stake in stakes_data:
            total_staked += int(stake.get('principal', 0)) / 1_000_000_000
            total_rewards += int(stake.get('rewards', 0)) / 1_000_000_000

        staked_usd = total_staked * sui_price if network == 'mainnet' else 0
        total_usd = sui_value_usd + staked_usd + total_token_value

        # Process NFTs and kiosk caps
        nft_counts = {}
        kiosk_caps = 0

        for obj in objects_data:
            obj_data = obj.get('data', {})
            obj_type = obj_data.get('type', '').lower()
            display = obj_data.get('display', {}) or {}
            name = display.get('name', '') or obj_type.split('::')[-1]

            if 'nft' in obj_type or 'collection' in obj_type:
                clean_name = name.strip()
                if not clean_name or clean_name == 'None':
                    clean_name = obj_type.split('::')[-1].title()
                nft_counts[clean_name] = nft_counts.get(clean_name, 0) + 1

            if 'kioskownercap' in obj_type or 'personalkioskcap' in obj_type:
                kiosk_caps += 1

        new_cursor = owned_objects.get('nextCursor')
        context.user_data['objects_cursor'] = new_cursor
        context.user_data['current_page'] = context.user_data.get('current_page', 1) + (1 if cursor else 0)

        # Build portfolio message
        message = ""

        # Add network header
        message += f"<b>{network_info['color']} {network_info['name']} Portfolio</b>\n"
        message += f"<code>{address[:8]}...{address[-6:]}</code>\n\n"

        # Add points notification if awarded
        if points_awarded:
            message += f"<b>🎉 +{PORTFOLIO_POINTS_DAILY} Points Awarded!</b>\n"
            message += f"You earned {PORTFOLIO_POINTS_DAILY} points for checking your portfolio today.\n\n"

        if network == 'mainnet':
            message += f"<b>💰 Total Portfolio Value: ~${total_usd:,.2f} USD</b>\n\n"
        else:
            # Calculate total testnet balance in SUI equivalent
            total_testnet_sui_equivalent = 0
            unknown_tokens = []

            for balance in full_balances:
                coin_type = balance['coinType']
                symbol = coin_type.split('::')[-1]
                amount = int(balance['totalBalance']) / 1_000_000_000

                # Get price for this token
                price = await get_testnet_token_price(symbol)
                token_value = amount * price
                total_testnet_sui_equivalent += token_value

                # Track unknown tokens for debugging
                if price == 0.001:  # Using default price
                    unknown_tokens.append(symbol)

            # Convert SUI equivalent to USD using current SUI price
            sui_price = get_sui_price_usd(context)
            total_testnet_usd = total_testnet_sui_equivalent * sui_price

            message += f"<b>🧪 Testnet Portfolio</b>\n"
            message += f"<b>💰 Total Value: ~${total_testnet_usd:,.2f} USD</b>\n"
            message += f"<i>({total_testnet_sui_equivalent:,.2f} SUI equivalent)</i>\n"

            # Show note if there are unknown tokens
            if unknown_tokens:
                message += f"<i>Note: {len(unknown_tokens)} tokens use estimated values</i>\n"

            message += "\n"

        message += "<b>🪙 Token Balances</b>:\n"
        if full_balances:
            # Show top 10 tokens by balance
            sorted_balances = sorted(full_balances, key=lambda x: int(x['totalBalance']), reverse=True)[:10]

            for balance in sorted_balances:
                coin_type = balance['coinType']
                symbol = coin_type.split('::')[-1]
                amount = int(balance['totalBalance']) / 1_000_000_000
                formatted_amount = "{:,.2f}".format(amount)

                if symbol == 'SUI' and network == 'mainnet':
                    usd_value = amount * sui_price
                    message += f"• {symbol}: {formatted_amount} (~${usd_value:,.2f} USD)\n"
                else:
                    message += f"• {symbol}: {formatted_amount}\n"

            if len(full_balances) > 10:
                message += f"(Showing top 10 of {len(full_balances)} tokens)\n"
        else:
            message += "No tokens found.\n"

        message += f"\n<b>🎯 Staking</b>:\n"
        if total_staked > 0:
            if network == 'mainnet':
                message += f"• Staked SUI: {total_staked:,.2f} (~${staked_usd:,.2f} USD)\n"
            else:
                message += f"• Staked SUI: {total_staked:,.2f}\n"
            message += f"• Pending Rewards: {total_rewards:,.2f} SUI\n"
            if stakes_data:
                validators = ", ".join({stake['validatorAddress'][:8] + '...' for stake in stakes_data})
                message += f"• Validators: {validators}\n"
        else:
            message += "No staking found.\n"

        message += f"\n<b>🖼️ NFTs & Collections (Page {context.user_data['current_page']})</b>:\n"
        if nft_counts:
            for name, count in list(nft_counts.items())[:10]:  # Show top 10
                message += f"• {name}: {count} items\n"
            if len(nft_counts) > 10:
                message += f"(and {len(nft_counts) - 10} more collections)\n"
            if new_cursor:
                message += "Tap 'Show More Assets' to see more.\n"
        else:
            message += "No NFTs found.\n"

        message += f"\n<b>🏪 Kiosks</b>:\n"
        total_kiosks = len(kiosk_ids) + kiosk_caps
        if total_kiosks > 0:
            message += f"• Kiosk Owner Caps: {kiosk_caps}\n"
            message += f"• Active Kiosks: {len(kiosk_ids)}\n"
            message += f"• Total Listings: {listed_items}\n"
        else:
            message += "No Kiosks found.\n"

        # Build navigation keyboard
        keyboard = []

        # Navigation buttons
        nav_buttons = []
        if context.user_data['current_page'] > 1:
            nav_buttons.append(InlineKeyboardButton("⬅️ Previous", callback_data='previous_page'))
        if new_cursor:
            nav_buttons.append(InlineKeyboardButton("Next ➡️", callback_data='load_more_objects'))
        if nav_buttons:
            keyboard.append(nav_buttons)

        # Network toggle button
        other_network = 'testnet' if network == 'mainnet' else 'mainnet'
        other_network_info = get_network_display_info(other_network)
        keyboard.append([InlineKeyboardButton(f"🔄 Switch to {other_network_info['name']}",
                                              callback_data=f'network_switch_{other_network}')])

        # Refresh button
        keyboard.append([InlineKeyboardButton("🔄 Refresh", callback_data='refresh_portfolio')])

        reply_markup = InlineKeyboardMarkup(keyboard)

        context.user_data['portfolio_cache'] = (message, reply_markup)
        context.user_data['portfolio_cache_time'] = time.time()

        messages = split_message(message)
        for i, msg_chunk in enumerate(messages):
            if i == 0:
                if update.callback_query:
                    await update.callback_query.edit_message_text(msg_chunk, parse_mode='HTML',
                                                                  reply_markup=reply_markup)
                else:
                    await update.message.reply_text(msg_chunk, parse_mode='HTML', reply_markup=reply_markup)
            else:
                target = update.callback_query.message if update.callback_query else update.message
                await target.reply_text(msg_chunk, parse_mode='HTML')

        return SHOW_PORTFOLIO
    except Exception:
        error_msg = (
            "❌ **Network Error**\n\n"
            f"Sorry, couldn't load your {network} portfolio right now.\n\n"
            "This might be due to:\n"
            "• Network congestion\n"
            "• Invalid address for this network\n"
            "• RPC endpoint issues\n\n"
            "Try switching networks or try again later!"
        )
        await update.message.reply_text(error_msg, parse_mode='Markdown')
        return SHOW_PORTFOLIO


async def load_more_objects(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    cursor = context.user_data.get('objects_cursor')
    if cursor:
        context.user_data['current_page'] += 1
        await show_portfolio_page(update, context, points_awarded=False, cursor=cursor)
    else:
        await query.edit_message_text("No more pages available.", parse_mode='HTML')
    return SHOW_PORTFOLIO


async def previous_page(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    if context.user_data['current_page'] > 1:
        context.user_data['current_page'] -= 1
        context.user_data['objects_cursor'] = None
        await show_portfolio_page(update, context, points_awarded=False)
    else:
        await query.edit_message_text("This is the first page.", parse_mode='HTML')
    return SHOW_PORTFOLIO


async def switch_network(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Switch between networks."""
    query = update.callback_query
    await query.answer()

    data = query.data
    new_network = data.replace('network_switch_', '')

    context.user_data['current_network'] = new_network
    context.user_data['portfolio_cache'] = None  # Clear cache for new network
    context.user_data['objects_cursor'] = None
    context.user_data['current_page'] = 1

    network_info = get_network_display_info(new_network)
    await query.edit_message_text(
        f"{network_info['color']} **Switched to {network_info['name']}**\n"
        f"Loading your portfolio...",
        parse_mode='Markdown'
    )

    await show_portfolio_page(update, context, points_awarded=False)
    return SHOW_PORTFOLIO


async def refresh_portfolio(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Refresh the current portfolio view."""
    query = update.callback_query
    await query.answer()

    context.user_data['portfolio_cache'] = None  # Clear cache
    await query.edit_message_text("🔄 Refreshing portfolio...")

    await show_portfolio_page(update, context, points_awarded=False)
    return SHOW_PORTFOLIO


def split_message(text: str, max_length: int = 4000) -> list:
    if len(text) <= max_length:
        return [text]
    lines = text.split('\n')
    chunks = []
    current = ''
    for line in lines:
        if len(current + line + '\n') > max_length:
            chunks.append(current.strip())
            current = line + '\n'
        else:
            current += line + '\n'
    if current:
        chunks.append(current.strip())
    return chunks


async def cancel_portfolio(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Cancel the portfolio conversation."""
    user_id = str(update.effective_user.id)

    # Clear any stored data
    context.user_data.clear()

    cancel_message = (
        "❌ **Portfolio Check Cancelled**\n\n"
        "You've exited the portfolio setup.\n\n"
        "You can always start again with /portfolio when you're ready! 🚀"
    )

    if update.callback_query:
        await update.callback_query.message.edit_text(cancel_message, parse_mode='Markdown')
    else:
        await update.message.reply_text(cancel_message, parse_mode='Markdown')

    return ConversationHandler.END


async def handle_cancel_callback(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Handle cancel button callback."""
    query = update.callback_query
    await query.answer()
    return await cancel_portfolio(update, context)


portfolio_handler = ConversationHandler(
    entry_points=[CommandHandler('portfolio', portfolio_command)],
    states={
        ENTER_ADDRESS: [
            CallbackQueryHandler(handle_network_selection, pattern='^network_'),
            CallbackQueryHandler(handle_cancel_callback, pattern='^cancel_portfolio$'),
            MessageHandler(filters.TEXT & ~filters.COMMAND, enter_address),
            CommandHandler('cancel', cancel_portfolio),
        ],
        SHOW_PORTFOLIO: [
            CallbackQueryHandler(load_more_objects, pattern='^load_more_objects$'),
            CallbackQueryHandler(previous_page, pattern='^previous_page$'),
            CallbackQueryHandler(switch_network, pattern='^network_switch_'),
            CallbackQueryHandler(refresh_portfolio, pattern='^refresh_portfolio$'),
        ],
    },
    fallbacks=[
        CommandHandler('cancel', cancel_portfolio),
        CommandHandler('portfolio', portfolio_command)
    ],
    allow_reentry=True
)