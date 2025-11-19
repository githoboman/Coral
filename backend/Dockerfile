# === Multi-stage Dockerfile for Tovira Backend ===

# -----------------------
# Stage 1: Builder
# -----------------------
FROM python:3.11-slim AS builder

WORKDIR /build

# Install build dependencies + Rust (for cryptography, tokenizers, etc.)
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc g++ make libffi-dev libssl-dev curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Install Rust
RUN curl https://sh.rustup.rs -sSf | sh -s -- -y --default-toolchain stable --profile minimal
ENV PATH="/root/.cargo/bin:${PATH}"

# Install uv (fast pip replacement)
RUN curl -LsSf https://astral.sh/uv/install.sh | sh
ENV PATH="/root/.local/bin:${PATH}"

# Verify tools
RUN uv --version && rustc --version

# Copy and install dependencies
COPY requirements.txt .
RUN uv pip install --system --no-cache-dir -r requirements.txt

# -----------------------
# Stage 2: Runtime
# -----------------------
FROM python:3.11-slim

LABEL maintainer="tovira.xyz"
LABEL description="Tovira - AI-powered Web3 Companion"
LABEL version="2.0.0"

# Environment
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

WORKDIR /app

# Only runtime system dependency we really need
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    && rm -rf /var/lib/apt/lists/* \
    && apt-get clean

# Create non-root user
RUN useradd -m -u 1000 -s /bin/bash tovira

# Copy installed Python packages from builder
COPY --from=builder /usr/local/lib/python3.11/site-packages /usr/local/lib/python3.11/site-packages
COPY --from=builder /usr/local/bin /usr/local/bin

# Copy application code
COPY --chown=tovira:tovira app/ ./app/
COPY --chown=tovira:tovira .env.example .env.example

# Switch to non-root user
USER tovira

# Critical fixes for Render:
# 1. EXPOSE must be a literal port at build time (Render looks for this)
# 2. Healthcheck must use a real port or shell expansion
EXPOSE 10000

HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=5 \
    CMD curl -f http://localhost:10000/health || exit 1

# Gunicorn will still bind to $PORT provided by Render at runtime
CMD gunicorn app.main:app \
    --workers 4 \
    --worker-class uvicorn.workers.UvicornWorker \
    --bind 0.0.0.0:$PORT \
    --timeout 120 \
    --access-logfile - \
    --error-logfile - \
    --log-level info