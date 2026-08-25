FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY gitwatcher ./gitwatcher

RUN mkdir -p /data

ENV PYTHONUNBUFFERED=1
ENV DATABASE_PATH=/data/gitwatcher.db
ENV PORT=8080

EXPOSE 8080

CMD ["python", "-m", "gitwatcher.main"]
