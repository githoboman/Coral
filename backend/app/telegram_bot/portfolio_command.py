from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.ext import ContextTypes, CommandHandler, MessageHandler, ConversationHandler, filters, CallbackQueryHandler
import requests
import logging
import os
from dotenv import load_dotenv
import re
import time
import urllib.parse
import asyncio
from functools import lru_cache

load_dotenv()

LOG_DIR = os.path.join("/tmp", "logs")
os.makedirs(LOG_DIR, exist_ok=True)

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler(os.path.join(LOG_DIR, "copilot.log")),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger(__name__)

SUI_RPC_URLS = [
    "https://sui-mainnet-endpoint.blockvision.org",
    "https://fullnode.mainnet.sui.io:443",
    "https://sui-rpc.publicnode.com",
    "https://rpc.ankr.com/sui",
]

ENTER_ADDRESS, SHOW_PORTFOLIO = range(2)
REQUEST_TIMEOUT = 5
PORTFOLIO_CACHE_TIMEOUT = 120


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


async def sui_rpc_call(payload: dict, retries: int = 2):
    for url in SUI_RPC_URLS:
        parsed = urllib.parse.urlparse(url)
        if not parsed.scheme or not parsed.netloc:
            logger.warning(f"Skipping invalid URL: {url}")
            continue
        for attempt in range(retries):
            try:
                logger.info(
                    f"Attempting RPC call to {url} (attempt {attempt + 1}/{retries}) with payload: {payload['method']}")
                response = await asyncio.get_event_loop().run_in_executor(
                    None, lambda: requests.post(
                        url, json=payload, timeout=REQUEST_TIMEOUT)
                )
                response.raise_for_status()
                result = response.json()
                logger.info(f"RPC success on {url}")
                return result
            except requests.exceptions.RequestException as e:
                logger.warning(
                    f"RPC attempt failed on {url}: {e}. Retrying...")
                if attempt < retries - 1:
                    await asyncio.sleep(2 ** attempt)
                else:
                    logger.error(f"Failed all retries on {url}. Trying next.")
    raise Exception("All RPC endpoints failed.")


@lru_cache(maxsize=1)
def get_sui_price_usd_cached(_: int = 0) -> float:
    """Cache SUI price for 10 minutes."""
    try:
        response = requests.get(
            "https://api.coingecko.com/api/v3/simple/price?ids=sui&vs_currencies=usd", timeout=5)
        response.raise_for_status()
        return response.json().get('sui', {}).get('usd', 0.0)
    except Exception as e:
        logger.warning(f"Price fetch failed: {e}")
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


async def portfolio_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user_id = str(update.effective_user.id)
    logger.info(f"Portfolio command started for user {user_id}")
    await update.message.reply_text("Enter your Sui address (e.g., 0x123...):")
    return ENTER_ADDRESS


async def enter_address(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user_id = str(update.effective_user.id)
    address = update.message.text.strip()
    logger.info(f"Received address {address} for user {user_id}")

    if not re.match(r'^0x[0-9a-fA-F]{64}$', address):
        await update.message.reply_text(
            "Invalid Sui address format. It must be 0x followed by 64 hex characters. Please try again.")
        return ENTER_ADDRESS

    try:
        context.user_data['sui_address'] = address
        context.user_data['objects_cursor'] = None
        context.user_data['current_page'] = 1
        context.user_data['portfolio_cache'] = None
        await show_portfolio_page(update, context)
        return SHOW_PORTFOLIO
    except Exception as e:
        logger.error(f"Error in enter_address for {address}: {e}")
        await update.message.reply_text("Error processing address. Try again later.")
        return ConversationHandler.END


async def show_portfolio_page(update: Update, context: ContextTypes.DEFAULT_TYPE, cursor: str = None):
    """Fetch and display portfolio with high-importance items."""
    address = context.user_data.get('sui_address')
    if not address:
        await update.message.reply_text("No address found. Start with /portfolio.")
        return SHOW_PORTFOLIO

    cache = context.user_data.get('portfolio_cache')
    cache_time = context.user_data.get('portfolio_cache_time', 0)
    if cache and time.time() - cache_time < PORTFOLIO_CACHE_TIMEOUT and cursor is None:
        logger.info(f"Using cached portfolio for {address}")
        message, reply_markup = cache
        messages = split_message(message)
        for i, msg_chunk in enumerate(messages):
            if i == 0:
                if update.callback_query:
                    await update.callback_query.edit_message_text(msg_chunk, parse_mode='HTML', reply_markup=reply_markup)
                else:
                    await update.message.reply_text(msg_chunk, parse_mode='HTML', reply_markup=reply_markup)
            else:
                target = update.callback_query.message if update.callback_query else update.message
                await target.reply_text(msg_chunk, parse_mode='HTML')
        return SHOW_PORTFOLIO

    try:
        balances_payload = {"jsonrpc": "2.0", "id": 1,
                            "method": "suix_getAllBalances", "params": [address]}
        objects_payload = {
            "jsonrpc": "2.0", "id": 1,
            "method": "suix_getOwnedObjects",
            "params": [
                address,
                {
                    "filter": None,
                    "options": {
                        "showType": True,
                        "showDisplay": True
                    }
                },
                cursor,
                50
            ]
        }
        stakes_payload = {"jsonrpc": "2.0", "id": 1,
                          "method": "suix_getStakes", "params": [address]}

        balances_result, objects_result, stakes_result = await asyncio.gather(
            sui_rpc_call(balances_payload),
            sui_rpc_call(objects_payload),
            sui_rpc_call(stakes_payload),
            return_exceptions=True
        )

        if isinstance(balances_result, Exception) or 'error' in balances_result:
            logger.error(f"Balances RPC failed: {balances_result}")
            full_balances = []
        else:
            full_balances = balances_result.get('result', [])
        if isinstance(objects_result, Exception) or 'error' in objects_result:
            logger.error(f"Objects RPC failed: {objects_result}")
            owned_objects = {}
        else:
            owned_objects = objects_result.get('result', {})
        if isinstance(stakes_result, Exception) or 'error' in stakes_result:
            logger.error(f"Stakes RPC failed: {stakes_result}")
            stakes_result = []
        else:
            stakes_result = stakes_result.get('result', [])

        balances = sorted(
            full_balances, key=lambda x: x['coinObjectCount'], reverse=True)[:5]
        new_cursor = owned_objects.get('nextCursor')
        context.user_data['objects_cursor'] = new_cursor
        context.user_data['current_page'] = context.user_data.get(
            'current_page', 1) + (1 if cursor else 0)

        sui_price = get_sui_price_usd(context)
        sui_balance = next(
            (b for b in balances if b['coinType'].endswith('::SUI')), None)
        sui_value_usd = (int(sui_balance['totalBalance']) / 1_000_000_000 *
                         sui_price) if sui_balance and sui_price > 0 else 0.0

        total_staked = sum(int(stake.get('principal', 0))
                           for stake in stakes_result) / 1_000_000_000
        total_rewards = sum(int(stake.get('rewards', 0))
                            for stake in stakes_result) / 1_000_000_000
        staked_usd = total_staked * sui_price

        objects_data = owned_objects.get('data', [])
        nft_counts = {}
        kiosk_caps = 0
        kiosk_ids = []
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

            if 'kiosk::kiosk' in obj_type:
                kiosk_ids.append(obj_data['objectId'])

        listed_items = 0
        if kiosk_ids:
            try:
                kiosk_payload = {
                    "jsonrpc": "2.0", "id": 1,
                    "method": "suix_getObjects",
                    "params": [kiosk_ids[:3], {"showContent": True}]
                }
                kiosk_result = await sui_rpc_call(kiosk_payload)
                if 'error' in kiosk_result:
                    logger.warning(f"Kiosk RPC error: {kiosk_result['error']}")
                else:
                    for obj in kiosk_result.get('result', []):
                        content = obj.get('content', {})
                        fields = content.get('fields', {})
                        items = fields.get('items', {}).get(
                            'fields', {}).get('items', [])
                        listed_items += len(items)
            except Exception as e:
                logger.warning(f"Failed to fetch kiosks: {e}")

        total_usd = sui_value_usd + staked_usd
        message = f"<b>Total Portfolio Value: ~${total_usd:,.2f} USD</b>\n\n"

        message += "<b>Top Tokens</b> (top holdings):\n"
        if balances:
            for balance in balances:
                coin_type = escape_html(balance['coinType'].split('::')[-1])
                amount = int(balance['totalBalance']) / 1_000_000_000
                formatted = "{:,.2f}".format(amount)
                if coin_type == 'SUI' and sui_value_usd:
                    formatted_usd = "{:,.2f}".format(sui_value_usd)
                    message += f"• {coin_type}: {formatted} (~${formatted_usd} USD)\n"
                else:
                    message += f"• {coin_type}: {formatted}\n"
            if len(full_balances) > 5:
                message += "(Showing top 5 - more tokens available)\n"
        else:
            message += "No tokens found.\n"

        message += f"\n<b>Staking</b>:\n"
        if total_staked > 0:
            message += f"• Staked SUI: {total_staked:,.2f} (~${staked_usd:,.2f} USD)\n"
            message += f"• Pending Rewards: {total_rewards:,.2f} SUI\n"
            if stakes_result:
                validators = ", ".join(
                    {stake['validatorAddress'][:6] + '...' for stake in stakes_result})
                message += f"• Validators: {validators}\n"
        else:
            message += "No staking found.\n"

        message += f"\n<b>Your NFTs (Page {context.user_data['current_page']})</b>:\n"
        if nft_counts:
            for name, count in nft_counts.items():
                message += f"{name} NFT x{count}\n"
            if new_cursor:
                message += "Tap 'Show More Assets' to see more.\n"
        else:
            message += "No NFTs found.\n"

        message += f"\n<b>Kiosks</b>:\n"
        total_kiosks = len(kiosk_ids) + kiosk_caps
        if total_kiosks > 0:
            message += f"• Owned: {total_kiosks} (Caps: {kiosk_caps}, Active Kiosks: {len(kiosk_ids)})\n"
            message += f"• Active Listings: {listed_items}\n"
        else:
            message += "No Kiosks found.\n"
        message += "\n<i>Data from Sui mainnet.</i>"

        keyboard = []
        if context.user_data['current_page'] > 1:
            keyboard.append([InlineKeyboardButton(
                "Previous Assets", callback_data='previous_page')])
        if new_cursor:
            keyboard.append([InlineKeyboardButton(
                "Show More Assets", callback_data='load_more_objects')])
        reply_markup = InlineKeyboardMarkup(keyboard) if keyboard else None

        context.user_data['portfolio_cache'] = (message, reply_markup)
        context.user_data['portfolio_cache_time'] = time.time()

        messages = split_message(message)
        for i, msg_chunk in enumerate(messages):
            if i == 0:
                if update.callback_query:
                    await update.callback_query.edit_message_text(msg_chunk, parse_mode='HTML', reply_markup=reply_markup)
                else:
                    await update.message.reply_text(msg_chunk, parse_mode='HTML', reply_markup=reply_markup)
            else:
                target = update.callback_query.message if update.callback_query else update.message
                await target.reply_text(msg_chunk, parse_mode='HTML')

        return SHOW_PORTFOLIO
    except Exception as e:
        logger.error(f"Error fetching portfolio page for {address}: {e}")
        await update.message.reply_text("Sorry, couldn't load your portfolio right now. Try again later!")
        return SHOW_PORTFOLIO


async def load_more_objects(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    cursor = context.user_data.get('objects_cursor')
    if cursor:
        context.user_data['current_page'] += 1
        await show_portfolio_page(update, context, cursor=cursor)
    else:
        await query.edit_message_text("No more pages available.", parse_mode='HTML')
    return SHOW_PORTFOLIO


async def previous_page(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    if context.user_data['current_page'] > 1:
        context.user_data['current_page'] -= 1
        context.user_data['objects_cursor'] = None
        await show_portfolio_page(update, context)
    else:
        await query.edit_message_text("This is the first page.", parse_mode='HTML')
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


# Create the conversation handler
portfolio_handler = ConversationHandler(
    entry_points=[CommandHandler('portfolio', portfolio_command)],
    states={
        ENTER_ADDRESS: [MessageHandler(filters.TEXT & ~filters.COMMAND, enter_address)],
        SHOW_PORTFOLIO: [
            CallbackQueryHandler(
                load_more_objects, pattern='^load_more_objects$'),
            CallbackQueryHandler(previous_page, pattern='^previous_page$')
        ],
    },
    fallbacks=[CommandHandler('portfolio', portfolio_command)],
    allow_reentry=True
)
