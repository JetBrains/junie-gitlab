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
RUN apt update && apt install -y git openssh-client tree curl
RUN mkdir /junieCache

# Install glab (GitLab CLI) via APT
RUN curl -sSL "https://raw.githubusercontent.com/upciti/wakemeops/main/assets/install_repository" | bash && \
    apt-get update && \
    apt-get install -y glab && \
    rm -rf /var/lib/apt/lists/*

# Copy minimal runtime artifacts
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/dist ./dist

