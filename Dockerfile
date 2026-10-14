FROM python:3.11-slim

WORKDIR /opt/zyvora

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

ENV ZYVORA_HOST=0.0.0.0 \
    ZYVORA_PORT=8000

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s CMD python -c "import urllib.request;urllib.request.urlopen('http://127.0.0.1:8000/health')" || exit 1

CMD ["python", "main.py"]
