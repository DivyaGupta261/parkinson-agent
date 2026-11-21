# Lesson 8: one container with the React UI and the Python API.
# Build:  docker build -t pd-agent .
# Run:    docker run -p 8000:8000 pd-agent            (demo mode: no key, no cost)

# --- Stage 1: build the React app ---------------------------------------------
FROM node:22.21.1-slim AS web
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

# --- Stage 2: the Python app ----------------------------------------------------
FROM python:3.12-slim
COPY --from=ghcr.io/astral-sh/uv:0.10.4 /uv /usr/local/bin/uv
WORKDIR /app
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project
COPY src/ src/
COPY examples/ examples/
RUN uv sync --frozen --no-dev
COPY --from=web /web/dist web/dist

# Demo mode by default, so a public deployment never spends your API credit.
ENV PD_DEMO=1
EXPOSE 8000
CMD ["uv", "run", "--no-sync", "pd", "serve", "--host", "0.0.0.0", "--port", "8000"]
