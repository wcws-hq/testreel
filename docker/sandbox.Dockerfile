# Throwaway test environment for Testreel. The container idles; every command is run in it with `docker exec`.
FROM node:22-bookworm

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
       git python3 python3-pip python3-venv python3-dev curl wget ca-certificates \
       build-essential pkg-config libssl-dev libffi-dev libsqlite3-dev libxml2-dev libxslt1-dev libjpeg-dev zlib1g-dev \
       sqlite3 unzip zip xz-utils jq procps iproute2 file less \
    && rm -rf /var/lib/apt/lists/*

RUN curl -LsSf https://astral.sh/uv/install.sh | env UV_INSTALL_DIR=/usr/local/bin sh \
    && env UV_TOOL_DIR=/opt/uv-tools UV_TOOL_BIN_DIR=/usr/local/bin uv tool install pip-audit \
    && corepack enable

USER node
WORKDIR /home/node
ENV PATH="/home/node/.local/bin:${PATH}" \
    npm_config_update_notifier=false \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    CI=1

CMD ["sleep", "infinity"]
