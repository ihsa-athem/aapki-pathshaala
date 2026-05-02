FROM python:3.11-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 8000

# Shell form so ${PORT} is expanded at runtime.
# railway.json startCommand overrides this, but this is the fallback for
# docker-compose / local docker run.
CMD sh -c "uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}"
