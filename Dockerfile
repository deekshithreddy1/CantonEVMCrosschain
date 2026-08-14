FROM node:22.18.0-bookworm-slim

WORKDIR /workspace
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages ./packages
COPY contracts/ethereum ./contracts/ethereum
COPY scripts ./scripts
RUN npm ci && npm run build --workspace @interweave/core

USER node
CMD ["node", "scripts/local/service.mjs"]
