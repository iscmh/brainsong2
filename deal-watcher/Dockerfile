# Runs the watcher 24/7 on any box with Docker. Playwright's image already ships Chromium.
FROM mcr.microsoft.com/playwright:v1.49.0-jammy

WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev --no-audit --no-fund

COPY . .
VOLUME ["/app/data", "/app/recordings"]
ENV NODE_ENV=production
CMD ["node", "src/index.js", "watch"]
