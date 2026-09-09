############################
# Builder stage
############################
FROM node:24-alpine AS builder
WORKDIR /app

# Install dependencies
COPY package.json package-lock.json* .npmrc* ./
# Use npm ci if lockfile exists, else fallback to npm install
RUN npm i

# Build
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Prune dev dependencies for production image
RUN npm prune --omit=dev

############################
# Runtime stage
############################
FROM node:24-trixie AS runner
WORKDIR /app

# simple-git requires the git CLI in the image
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    openssh-client \
    tree \
    curl \
    unzip \
    libjpeg62-turbo \
    && rm -rf /var/lib/apt/lists/*
RUN mkdir /junieCache

# Junie's bundled JVM AWT library links against the legacy libjpeg.so.8, which
# is no longer packaged on Debian trixie (only libjpeg62-turbo / libjpeg.so.62
# is available). Create a compatibility symlink so Junie can find it.
RUN LIBJPEG_SO_62="$(dpkg -L libjpeg62-turbo | grep -E 'libjpeg\.so\.62$')" && \
    ln -s "${LIBJPEG_SO_62}" "$(dirname "${LIBJPEG_SO_62}")/libjpeg.so.8" && \
    ldconfig

# Install glab (GitLab CLI) via APT
RUN curl -sSL "https://raw.githubusercontent.com/upciti/wakemeops/main/assets/install_repository" | bash && \
    apt-get update && \
    apt-get install -y glab && \
    rm -rf /var/lib/apt/lists/*

# Install Junie
RUN curl -fsSL https://junie.jetbrains.com/install.sh | bash

# Add $HOME/.local/bin (with Junie's executable file) to PATH
ENV PATH="/root/.local/bin:$PATH"

# Copy minimal runtime artifacts
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/dist ./dist
COPY assets /assets/

