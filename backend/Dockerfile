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

<<<<<<< HEAD
# Install Rust
RUN curl https://sh.rustup.rs -sSf | sh -s -- -y --default-toolchain stable --profile minimal
ENV PATH="/root/.cargo/bin:${PATH}"

# Install uv
=======
# Install Rust (needed for cryptography, tokenizers, etc.)
RUN curl https://sh.rustup.rs -sSf | sh -s -- -y --default-toolchain stable --profile minimal
ENV PATH="/root/.cargo/bin:${PATH}"

# Install uv the bulletproof way (official installer → always works)
>>>>>>> 106d1747a26affb7199063dfe97b98baf667aede
RUN curl -LsSf https://astral.sh/uv/install.sh | sh
ENV PATH="/root/.local/bin:${PATH}"

# Verify tools
RUN uv --version && rustc --version

<<<<<<< HEAD
# Install dependencies
=======
# Copy requirements and install everything into the SYSTEM Python
>>>>>>> 106d1747a26affb7199063dfe97b98baf667aede
COPY requirements.txt .
RUN uv pip install --system --no-cache-dir -r requirements.txt

# -----------------------
<<<<<<< HEAD
# Stage 2: Runtime
=======
# Stage 2: Runtime (super slim, secure)
>>>>>>> 106d1747a26affb7199063dfe97b98baf667aede
# -----------------------
FROM python:3.11-slim

LABEL maintainer="tovira.xyz"
LABEL description="Tovira - AI-powered Web3 Companion"
LABEL version="2.0.0"

<<<<<<< HEAD
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PORT=10000

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    && rm -rf /var/lib/apt/lists/*
=======
# Environment
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PORT=8000

WORKDIR /app

# Only runtime deps
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    && rm -rf /var/lib/apt/lists/* \
    && apt-get clean
>>>>>>> 106d1747a26affb7199063dfe97b98baf667aede

# Create non-root user
RUN useradd -m -u 1000 -s /bin/bash tovira

<<<<<<< HEAD
# Copy installed Python packages from builder
COPY --from=builder /usr/local/lib/python3.11/site-packages /usr/local/lib/python3.11/site-packages
COPY --from=builder /usr/local/bin /usr/local/bin

# Copy full project root
COPY --chown=tovira:tovira . .

# Create app-specific directories
RUN mkdir -p \
    /app/keys \
    /app/logs \
    /app/data \
    /app/registration_receipts \
    /app/user_checkins \
    /app/user_keys \
    /app/user_sessions \
    /app/user_wallets \
    /app/otp_storage \
    && chown -R tovira:tovira /app
=======
# Copy Python packages + binaries from builder (system-wide install → clean & reliable)
COPY --from=builder /usr/local/lib/python3.11/site-packages /usr/local/lib/python3.11/site-packages
COPY --from=builder /usr/local/bin /usr/local/bin

# Copy app code
COPY --chown=tovira:tovira app/ ./app/
COPY --chown=tovira:tovira .env.example .env.example
>>>>>>> 106d1747a26affb7199063dfe97b98baf667aede

# Switch to non-root user
USER tovira

<<<<<<< HEAD
# Optional healthcheck (non-blocking)
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD curl -f http://localhost:${PORT:-10000}/health || exit 0

# Run the Telegram bot instead of FastAPI
CMD ["python", "-u", "Telegrambot_change.py"]
=======
EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD curl -f http://localhost:${PORT}/health || exit 1

# Run with Gunicorn + Uvicorn workers
CMD gunicorn app.main:app \
    --workers 4 \
    --worker-class uvicorn.workers.UvicornWorker \
    --bind 0.0.0.0:$PORT \
    --timeout 120 \
    --access-logfile - \
    --error-logfile - \
    --log-level info
>>>>>>> 106d1747a26affb7199063dfe97b98baf667aede
