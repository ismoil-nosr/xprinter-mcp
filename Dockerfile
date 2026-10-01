# SPDX-License-Identifier: MIT
# syntax=docker/dockerfile:1
FROM --platform=$BUILDPLATFORM node:26-alpine@sha256:0b36e8c136b94cd4fcf02188228e76c31ad5872eef3fec8cbd2eee500cfd9e80 AS build
WORKDIR /build
COPY package.json npm-shrinkwrap.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM --platform=$BUILDPLATFORM node:26-alpine@sha256:0b36e8c136b94cd4fcf02188228e76c31ad5872eef3fec8cbd2eee500cfd9e80 AS dependencies
WORKDIR /dependencies
COPY package.json npm-shrinkwrap.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund

FROM node:26-alpine@sha256:0b36e8c136b94cd4fcf02188228e76c31ad5872eef3fec8cbd2eee500cfd9e80 AS runtime
RUN apk add --no-cache openssh-client \
    && rm -rf /usr/local/lib/node_modules /opt/yarn-v* \
    && rm -f /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /usr/local/bin/yarn /usr/local/bin/yarnpkg \
    && mkdir -p /var/lib/xprinter /run/secrets \
    && chown node:node /var/lib/xprinter \
    && chmod 0700 /var/lib/xprinter
WORKDIR /app
COPY --from=dependencies /dependencies/node_modules ./node_modules
COPY --from=build /build/dist ./dist
COPY package.json npm-shrinkwrap.json LICENSE SECURITY.md README.md ./
COPY docs ./docs
ARG VERSION=0.2.1
ARG REVISION=unknown
LABEL org.opencontainers.image.title="Open Xprinter MCP" \
      org.opencontainers.image.description="Label preparation, preview and controlled printing; SSH to the Mac hosting the XP-330B USB printer" \
      org.opencontainers.image.source="https://github.com/ismoil-nosr/xprinter-mcp" \
      org.opencontainers.image.url="https://github.com/ismoil-nosr/xprinter-mcp" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.version=$VERSION \
      org.opencontainers.image.revision=$REVISION
ENV NODE_ENV=production XPRINTER_BACKEND=ssh XPRINTER_CONTAINER=1 \
    XPRINTER_STATE_DIR=/var/lib/xprinter XPRINTER_ALLOW_PRINT=0
USER node
EXPOSE 8787
STOPSIGNAL SIGTERM
ENTRYPOINT ["node", "dist/cli.js"]
CMD ["stdio"]
