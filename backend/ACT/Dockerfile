# === Multi-stage Dockerfile for Tovira Backend ===

# -----------------------
# Stage 1: Builder
# -----------------------
FROM python:3.11-slim AS builder

WORKDIR /build

# Install build dependencies + Rust
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc g++ make libffi-dev libssl-dev curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Install Rust
RUN curl https://sh.rustup.rs -sSf | sh -s -- -y --default-toolchain stable --profile minimal
ENV PATH="/root/.cargo/bin:${PATH}"

# Install uv
RUN curl -LsSf https://astral.sh/uv/install.sh | sh
ENV PATH="/root/.local/bin:${PATH}"

# Verify tools
RUN uv --version && rustc --version

# Install dependencies
COPY requirements.txt .
RUN uv pip install --system --no-cache-dir -r requirements.txt

# -----------------------
# Stage 2: Runtime
# -----------------------
FROM python:3.11-slim

LABEL maintainer="tovira.xyz"
LABEL description="Tovira - AI-powered Web3 Companion"
LABEL version="2.0.0"

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PORT=10000

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    && rm -rf /var/lib/apt/lists/* \
    && apt-get clean

# Create non-root user
RUN useradd -m -u 1000 -s /bin/bash tovira

# Copy installed packages
COPY --from=builder /usr/local/lib/python3.11/site-packages /usr/local/lib/python3.11/site-packages
COPY --from=builder /usr/local/bin /usr/local/bin

# Copy project root directory
COPY --chown=tovira:tovira . .

# Create needed directories
RUN mkdir -p /app/keys /app/logs /app/data /app/registration_receipts \
    /app/user_checkins /app/user_keys /app/user_sessions \
    /app/user_wallets /app/otp_storage \
    && chown -R tovira:tovira /app

# Switch to non-root user
USER tovira

# Optional healthcheck (skip if not required)
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD curl -f http://localhost:${PORT:-10000}/health || exit 0

# Launch Telegram bot directly
CMD ["python", "Telegrambot_change.py"]
