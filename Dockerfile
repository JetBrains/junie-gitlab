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
RUN apt update && apt install -y git openssh-client tree curl unzip
RUN mkdir /junieCache

# Install glab from the official GitLab CLI releases
ARG GLAB_VERSION=1.108.0
RUN GLAB_ARCH="$(dpkg --print-architecture)" && \
    curl -fsSL -o /tmp/glab.deb "https://gitlab.com/gitlab-org/cli/-/releases/v${GLAB_VERSION}/downloads/glab_${GLAB_VERSION}_linux_${GLAB_ARCH}.deb" && \
    apt-get update && \
    apt-get install -y /tmp/glab.deb && \
    rm -f /tmp/glab.deb && \
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

