# ResearchMap v0.1 — 单容器生产镜像（前端 dist + FastAPI 同源）
#
# 数据放卷：RESEARCHMAP_DB=/data/researchmap.db，VOLUME /data。
# 令牌经 RESEARCHMAP_TOKENS（内联 JSON：{"名字":"令牌"}）注入，不进镜像。

# syntax=docker/dockerfile:1

FROM node:22-slim AS frontend-build
WORKDIR /src
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM python:3.13-slim
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    RESEARCHMAP_STATIC=/app/frontend-dist \
    RESEARCHMAP_DB=/data/researchmap.db
WORKDIR /app
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY backend/ .
COPY --from=frontend-build /src/frontend/dist ./frontend-dist

VOLUME ["/data"]
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
  CMD python -c "import urllib.request;urllib.request.urlopen('http://127.0.0.1:8000/healthz',timeout=2)"

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]