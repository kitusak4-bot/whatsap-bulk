FROM node:20-alpine AS base
WORKDIR /app

# better-sqlite3 needs build tools
RUN apk add --no-cache python3 make g++

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY . .

# Create persistent directories
RUN mkdir -p data logs campaigns auth

EXPOSE 3000 4000

CMD ["node", "src/server.js"]
