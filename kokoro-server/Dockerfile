FROM python:3.12-slim

WORKDIR /app

# phonemizer-fork links against libespeak-ng at runtime
RUN apt-get update \
 && apt-get install -y --no-install-recommends libespeak-ng1 \
 && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY server.py .

ENV CACHE_DIR=/app/cache
ENV PORT=5423

EXPOSE 5423

CMD ["sh", "-c", "python -m uvicorn server:app --host 0.0.0.0 --port ${PORT:-5423}"]
