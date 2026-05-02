FROM python:3.11-slim

# ── System dependencies ───────────────────────────────────────────────────────
# nodejs  — primary JS runtime for yt-dlp's YouTube n-challenge solver
#           (yt-dlp 2026.x no longer auto-detects node; needs --js-runtimes node)
# curl    — needed to install deno below
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    nodejs \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Verify node is on PATH (fails the build loudly if nodejs was not installed)
RUN node --version

# ── Install deno as additional JS runtime fallback ────────────────────────────
# Installing to /usr/local so the binary lands at /usr/local/bin/deno,
# which is already on PATH — no ENV change needed.
RUN curl -fsSL https://deno.land/install.sh | DENO_INSTALL=/usr/local sh \
    && deno --version \
    || echo "WARNING: deno install failed — node will be used instead"

# ── Python dependencies ───────────────────────────────────────────────────────
WORKDIR /app

COPY backend/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

# ── Application source ────────────────────────────────────────────────────────
COPY backend/ .

COPY start.sh ./start.sh
RUN chmod +x ./start.sh

EXPOSE 8000

CMD ["./start.sh"]
