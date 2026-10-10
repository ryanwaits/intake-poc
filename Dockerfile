FROM oven/bun:1.4.2-alpine AS deps
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

FROM oven/bun:1.4.2-alpine
WORKDIR /app
# Take Alpine security fixes released after the base image was built (CI scans for HIGH/CRITICAL).
RUN apk upgrade --no-cache
ENV NODE_ENV=production PORT=8080
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src
USER bun
EXPOSE 8080
CMD ["bun", "src/api/server.ts"]
