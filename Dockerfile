FROM python:3.11-slim

# System dependencies
# nodejs — required by yt-dlp as a JavaScript runtime (needed to solve YouTube's n-challenge)
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    nodejs \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python dependencies first (cached layer)
COPY backend/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

# Copy backend source
COPY backend/ .

# Copy startup script and make executable
COPY start.sh ./start.sh
RUN chmod +x ./start.sh

EXPOSE 8000

CMD ["./start.sh"]
