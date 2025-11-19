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

# Install Rust (needed for cryptography, tokenizers, etc.)
RUN curl https://sh.rustup.rs -sSf | sh -s -- -y --default-toolchain stable --profile minimal
ENV PATH="/root/.cargo/bin:${PATH}"

# Install uv (bulletproof installer)
RUN curl -LsSf https://astral.sh/uv/install.sh | sh
ENV PATH="/root/.local/bin:${PATH}"

# Verify tools
RUN uv --version && rustc --version

# Copy requirements and install everything into SYSTEM Python
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

# Runtime dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    && rm -rf /var/lib/apt/lists/* \
    && apt-get clean

# Create non-root user
RUN useradd -m -u 1000 -s /bin/bash tovira

# Copy Python packages + binaries from builder
COPY --from=builder /usr/local/lib/python3.11/site-packages /usr/local/lib/python3.11/site-packages
COPY --from=builder /usr/local/bin /usr/local/bin

# Copy app code
COPY --chown=tovira:tovira app/ ./app/
COPY --chown=tovira:tovira .env.example .env.example

# Switch to non-root user
USER tovira

# Expose Render runtime port dynamically
EXPOSE $PORT

# Healthcheck using dynamic port
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD curl -f http://localhost:$PORT/health || exit 1

# Run Gunicorn + Uvicorn workers, binding to dynamic port
CMD gunicorn app.main:app \
    --workers 4 \
    --worker-class uvicorn.workers.UvicornWorker \
    --bind 0.0.0.0:$PORT \
    --timeout 120 \
    --access-logfile - \
    --error-logfile - \
    --log-level info
