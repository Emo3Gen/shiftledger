FROM node:20-alpine

# canvas native dependency needs build tools + libs
RUN apk add --no-cache \
    build-base \
    g++ \
    cairo-dev \
    jpeg-dev \
    pango-dev \
    giflib-dev \
    librsvg-dev \
    pixman-dev \
    pangomm-dev \
    libjpeg-turbo-dev \
    freetype-dev

WORKDIR /app

# Install deps from root package.json (has all backend deps)
COPY package*.json ./
COPY backend/package.json ./backend/
RUN npm ci --omit=dev

# Copy backend source
COPY backend/ ./backend/

# Copy pre-built frontend (preserving relative path from backend/)
COPY apps/simulator/dist/ ./apps/simulator/dist/

EXPOSE 3000

# Production env
ENV NODE_ENV=production
ENV APP_ENV=production

CMD ["node", "backend/server.js"]
