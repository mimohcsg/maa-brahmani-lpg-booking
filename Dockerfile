FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

RUN mkdir -p data

ENV NODE_ENV=production
ENV PORT=3456

EXPOSE 3456

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD wget -qO- http://localhost:3456/api/health || exit 1

CMD ["node", "server.js"]
