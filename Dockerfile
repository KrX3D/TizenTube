# syntax = docker/dockerfile:1.2
## Build TizenTube Standalone App
FROM --platform=linux/amd64 node:20-slim

WORKDIR /tizentube

VOLUME ["/tizentube/mods/node_modules"]
VOLUME ["/tizentube/standalone/node_modules"]

# Copy source files
COPY package*.json ./
COPY mods/ ./mods/
COPY standalone/ ./standalone/

# Install pnpm and dependencies
RUN corepack enable pnpm && \
    cd mods && pnpm install && \
    cd ../standalone && pnpm install

# Build TizenTube user scripts and standalone app
RUN cd mods && pnpm run build && \
    cd ../standalone && pnpm run build

## Package TizenTube WGT
FROM --platform=linux/amd64 eclipse-temurin:11

WORKDIR /tizen

# Copy built TizenTube app
COPY --from=0 /tizentube/standalone/dist ./tizentube-app
COPY docker/package.sh /tizen/package.sh
COPY docker/expect_script /tizen/expect_script


RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
  --mount=type=cache,target=/var/lib/apt,sharing=locked \
  apt-get update \
  && apt-get --no-install-recommends install -y unzip zip expect libxml2-utils


# Install Tizen Studio and dependencies
RUN useradd tizen --home-dir /tizen \
    && chown -R tizen:tizen ./ \
    && mkdir -p /tizen/tizen-studio-data/keystore/author \
    && chown -R tizen:tizen /tizen/tizen-studio-data/keystore

USER tizen

# Install Tizen Studio
RUN --mount=type=bind,source=web-cli_Tizen_Studio_5.1_ubuntu-64.bin,target=/tmp/web-cli_Tizen_Studio_5.1_ubuntu-64.bin \
    echo 'export PATH=$PATH:/tizen/tizen-studio/tools/ide/bin' >> .bashrc \
    && /tmp/web-cli_Tizen_Studio_5.1_ubuntu-64.bin --accept-license /tizen/tizen-studio

VOLUME ["/output"]
VOLUME ["/tizen/tizen-studio-data/keystore/author"]

CMD /tizen/package.sh