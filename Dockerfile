# Stage 1: Build frontend
FROM node:20-alpine AS frontend
WORKDIR /app
RUN apk add --no-cache python3 make g++
COPY apps/simulator/package*.json ./apps/simulator/
RUN cd apps/simulator && npm ci
COPY apps/simulator/ ./apps/simulator/
RUN cd apps/simulator && npx vite build

# Stage 2: Backend
FROM node:20-alpine
WORKDIR /app

# canvas native dependency needs build tools + libs
RUN apk add --no-cache \
    build-base g++ cairo-dev jpeg-dev pango-dev \
    giflib-dev librsvg-dev pixman-dev pangomm-dev \
    libjpeg-turbo-dev freetype-dev

# Install deps from root package.json
COPY package*.json ./
COPY backend/package.json ./backend/
RUN npm ci --omit=dev

# Copy backend source
COPY backend/ ./backend/

# Copy built frontend from stage 1
COPY --from=frontend /app/apps/simulator/dist/ ./apps/simulator/dist/

EXPOSE 3000

ENV NODE_ENV=production
ENV APP_ENV=production

CMD ["node", "backend/server.js"]
