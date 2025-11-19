# ===== Stage 1: Builder =====
FROM python:3.11-slim AS builder

# Set environment variables for pip
ENV PIP_NO_CACHE_DIR=1 \
    PYTHONUNBUFFERED=1

# Install build dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Set workdir
WORKDIR /app

# Copy requirements and install them
COPY requirements.txt .
RUN pip install --prefix=/install -r requirements.txt

# ===== Stage 2: Runtime =====
FROM python:3.11-slim

# Install runtime dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Create a non-root user
RUN useradd -m -u 1000 -s /bin/bash tovira

# Copy installed packages from builder
COPY --from=builder /install /usr/local

# Set workdir
WORKDIR /app

# Copy application code
COPY --chown=tovira:tovira app/ ./app/
COPY --chown=tovira:tovira .env.example .env.example

# Copy entrypoint script
COPY --chown=tovira:tovira entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# Set user
USER tovira

# Use entrypoint
ENTRYPOINT ["/entrypoint.sh"]
