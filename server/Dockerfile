# Pulso server — build context: repository root (docker build -f server/Dockerfile .)

# 1) Analysis engine (Swift, reuses the tested WhoopKit core)
FROM swift:6.0-jammy AS engine
WORKDIR /src
COPY Packages/WhoopKit ./WhoopKit
RUN cd WhoopKit \
 && swift build -c release --product pulso-engine --static-swift-stdlib \
 && (strip .build/release/pulso-engine || true) \
 && cp .build/release/pulso-engine /pulso-engine

# 2) API + web (Python)
FROM python:3.12-slim-bookworm
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 TZ=Europe/Madrid \
    PULSO_DATA=/data PULSO_ENGINE=/usr/local/bin/pulso-engine PULSO_WEB=/app/web
RUN apt-get update \
 && apt-get install -y --no-install-recommends tzdata ca-certificates libstdc++6 \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY server/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY --from=engine /pulso-engine /usr/local/bin/pulso-engine
RUN pulso-engine version
COPY server/app ./app
COPY server/web ./web
VOLUME /data
EXPOSE 8090
HEALTHCHECK --interval=60s --timeout=5s CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8090/api/health')"
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8090", "--proxy-headers", "--forwarded-allow-ips", "*"]
