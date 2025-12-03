from pydantic_settings import BaseSettings
from pydantic import Field, field_validator
from dotenv import load_dotenv
from functools import lru_cache
import logging
import os

logger = logging.getLogger(__name__)

load_dotenv()


class Settings(BaseSettings):
    """
    Application settings with validation and defaults.
    """

    ENVIRONMENT: str = Field(
        default="development", description="Environment: development, staging, production")
    DEBUG: bool = Field(default=False, description="Debug mode")
    LOG_LEVEL: str = Field(default="INFO", description="Logging level")

    SUPABASE_URL: str = Field(..., description="Supabase project URL")
    SUPABASE_KEY: str = Field(..., description="Supabase anon/service key")

    GEMINI_API_KEY: str = Field(..., description="Google Gemini API key")
    TAVILY_API_KEY: str = Field(
        default="", description="Tavily API key for web search")
    AGENT: str | None = Field(default=None, description="Default agent mode")
    LLM_MODEL: str = Field(default="gemini-2.5-flash",
                           description="LLM model name")
    LLM_TEMPERATURE: float = Field(
        default=0.3, ge=0.0, le=2.0, description="LLM temperature")
    LLM_MAX_RETRIES: int = Field(
        default=3, ge=1, le=10, description="Max LLM retry attempts")
    AGENT_TIMEOUT: int = Field(
        default=30, ge=5, le=120, description="Agent timeout in seconds")

    TELEGRAM_BOT_TOKEN: str = Field(
        default="", description="Telegram bot token")
    BOT_USERNAME: str | None = Field(
        default=None, description="Telegram bot username")
    TELEGRAM_WEBHOOK_URL: str | None = Field(
        default=None, description="Telegram webhook URL for production")
    TELEGRAM_USE_WEBHOOK: bool = Field(
        default=False, description="Use webhook instead of polling")

    SUI_NETWORK_RPC: str = Field(
        default="https://fullnode.mainnet.sui.io:443", description="Sui Network RPC endpoint")
    SUI_DEVNET_RPC: str = Field(
        default="https://fullnode.devnet.sui.io:443", description="Sui Devnet RPC")
    USE_MAINNET: bool = Field(
        default=True, description="Use mainnet instead of devnet")

    COINGECKO_API_KEY: str = Field(
        default="", description="CoinGecko API key (optional)")
    DEFILLAMA_API_URL: str = Field(
        default="https://api.llama.fi", description="DefiLlama API base URL")
    DEXSCREENER_API_URL: str = Field(
        default="https://api.dexscreener.com/latest/dex", description="DexScreener API")

    BLOCKVISION_API_KEY: str = Field(
        default="", description="BlockVision API key for Sui data")
    BLOCKVISION_BASE_URL: str = Field(
        default="https://api.blockvision.org/v1/sui",
        description="Base URL for BlockVision Sui API"
    )

    REDIS_URL: str = Field(default="redis://localhost:6379/0",
                           description="Redis connection URL")
    REDIS_PASSWORD: str = Field(default="", description="Redis password")
    ENABLE_REDIS_CACHE: bool = Field(
        default=True, description="Enable Redis caching")
    CACHE_TTL: int = Field(default=300, ge=10, le=3600,
                           description="Cache TTL in seconds")

    RATE_LIMIT_ENABLED: bool = Field(
        default=True, description="Enable rate limiting")
    MAX_REQUESTS_PER_MINUTE: int = Field(
        default=60, ge=10, le=1000, description="Max requests per minute")
    MAX_REQUESTS_PER_HOUR: int = Field(
        default=1000, ge=100, le=10000, description="Max requests per hour")

    CIRCUIT_BREAKER_THRESHOLD: int = Field(default=5, ge=1, le=20)
    CIRCUIT_BREAKER_TIMEOUT: int = Field(default=120, ge=30, le=600)

    EMAIL_USER: str | None = None
    EMAIL_PASSWORD: str | None = None
    EMAIL_FROM: str = Field(default="noreply@tovira.xyz")
    SMTP_HOST: str = Field(default="smtp.gmail.com")
    SMTP_PORT: int = Field(default=587)

    SECRET_KEY: str = Field(
        default="", description="Secret key (min 32 chars for production)")
    ALLOWED_ORIGINS: list[str] = Field(
        default=[
            "http://localhost:5173",
            "https://tovira.xyz",
            "https://www.tovira.xyz"
        ]
    )

    SENTRY_DSN: str = Field(default="", description="Sentry DSN")
    ENABLE_METRICS: bool = Field(default=True)

    CELERY_BROKER_URL: str = Field(default="redis://localhost:6379/1")
    CELERY_RESULT_BACKEND: str = Field(default="redis://localhost:6379/2")

    COPILOT_TREASURY_ID: str | None = None
    COPILOT_REGISTRY_ID: str | None = None
    COPILOT_PACKAGE_ID: str | None = None
    TASK_DB_ENCRYPTION_KEY: str | None = None
    SERVER_MASTER_KEY: str | None = None
    WAITLIST_SALT: str | None = None
    WHITELIST_BLOB_ID: str | None = None
    EMAIL_INDEX_PASSWORD: str | None = None
    INFURA_PROJECT_ID: str | None = None
    ADMIN_ID: str | None = None
    API_KEY_WALLET: str | None = None

    SUI_RPC_URL: str | None = Field(default=None, extra="ignore")

    class Config:
        env_file = ".env"
        case_sensitive = True

    @field_validator("ENVIRONMENT")
    @classmethod
    def validate_environment(cls, v):
        allowed = ["development", "staging", "production"]
        if v not in allowed:
            raise ValueError(f"ENVIRONMENT must be one of {allowed}")
        return v

    @field_validator("SECRET_KEY")
    @classmethod
    def validate_secret_key(cls, v, values):
        env = values.data.get("ENVIRONMENT", "development")
        if env == "production" and (not v or len(v) < 32):
            raise ValueError(
                "SECRET_KEY must be at least 32 characters in production")
        return v

    @property
    def sui_rpc_url(self) -> str:
        return self.SUI_NETWORK_RPC if self.USE_MAINNET else self.SUI_DEVNET_RPC

    @property
    def is_production(self) -> bool:
        return self.ENVIRONMENT == "production"

    @property
    def is_development(self) -> bool:
        return self.ENVIRONMENT == "development"

    def log_settings(self):
        logger.info("=== Tovira Configuration ===")
        logger.info(f"Environment: {self.ENVIRONMENT}")
        logger.info(f"Debug Mode: {self.DEBUG}")
        logger.info(f"Log Level: {self.LOG_LEVEL}")
        logger.info(f"Supabase URL: {self.SUPABASE_URL[:30]}...")
        logger.info(
            f"Gemini API: {'✓ Configured' if self.GEMINI_API_KEY else '✗ Missing'}")
        logger.info(
            f"Tavily API: {'✓ Configured' if self.TAVILY_API_KEY else '✗ Missing'}")
        logger.info(
            f"BlockVision: {'✓ Configured' if self.BLOCKVISION_API_KEY else '✗ Missing'}")
        logger.info(
            f"Sui Network: {'Mainnet' if self.USE_MAINNET else 'Devnet'}")
        logger.info("==================================")


@lru_cache()
def get_settings() -> Settings:
    return Settings()


settings = get_settings()


def validate_configuration():
    errors = []
    warnings = []

    if not settings.SUPABASE_URL or not settings.SUPABASE_KEY:
        errors.append("Missing SUPABASE_URL or SUPABASE_KEY")

    if not settings.GEMINI_API_KEY:
        errors.append("Missing GEMINI_API_KEY - AI features will not work")

    if not settings.TAVILY_API_KEY:
        warnings.append(
            "TAVILY_API_KEY not set - Deep research agent will have limited search capabilities")

    if settings.is_production and (not settings.SECRET_KEY or len(settings.SECRET_KEY) < 32):
        errors.append(
            "SECRET_KEY must be at least 32 characters in production")

    if not settings.BLOCKVISION_API_KEY:
        warnings.append(
            "BLOCKVISION_API_KEY not set - Sui data integration limited")

    if errors:
        error_msg = "Configuration validation failed:\n" + \
            "\n".join(f"- {e}" for e in errors)
        logger.error(error_msg)
        raise ValueError(error_msg)

    for w in warnings:
        logger.warning(w)

    settings.log_settings()
    logger.info("✓ Configuration validation passed")


if settings.TAVILY_API_KEY:
    os.environ["TAVILY_API_KEY"] = settings.TAVILY_API_KEY

try:
    validate_configuration()
except ValueError as e:
    if settings.is_production:
        raise
    logger.warning(f"Configuration issues detected in development: {e}")
