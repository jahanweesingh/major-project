FROM python:3.12-slim AS runtime-base

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    DATABASE_PATH=/data/chat.db

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir --requirement requirements.txt

FROM runtime-base AS test

COPY requirements-dev.txt pytest.ini ./
RUN pip install --no-cache-dir --requirement requirements-dev.txt
COPY app ./app
COPY tests ./tests
CMD ["pytest"]

FROM runtime-base AS production

COPY app ./app
RUN useradd --create-home --uid 10001 chatapp \
    && mkdir -p /app/data /data \
    && chown -R chatapp:chatapp /app /data

USER chatapp
EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/api/health', timeout=2)" || exit 1

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers"]
