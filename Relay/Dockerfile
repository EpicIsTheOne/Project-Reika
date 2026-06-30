FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM deps AS build
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV REIKA_RELAY_HOST=0.0.0.0
ENV REIKA_RELAY_PORT=8790
ENV REIKA_RELAY_STORE_PATH=/data/relay-store.json
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
VOLUME ["/data"]
EXPOSE 8790
CMD ["node", "dist/relay/server.js"]
