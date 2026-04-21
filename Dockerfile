FROM oven/bun:1 AS builder
WORKDIR /app
COPY package.json web/package.json web/
RUN cd web && bun install && bun run build

FROM oven/bun:1
WORKDIR /app
COPY package.json ./
COPY --from=builder /app/web/dist ./web/dist
COPY server ./server
COPY bin ./bin
COPY scripts ./scripts
COPY web/dist ./web/dist
COPY web/package.json ./
RUN bun install --production
RUN chmod +x /app/scripts/docker-entry.sh
EXPOSE 4097
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:4097/api/health || exit 1
ENTRYPOINT ["/app/scripts/docker-entry.sh"]
