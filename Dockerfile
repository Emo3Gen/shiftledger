# Stage 1: Build frontend
FROM node:20-alpine AS frontend
ARG CACHEBUST=1
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

# Install root deps (canvas, grammy, pino, swagger, etc.)
COPY package*.json ./
RUN npm ci --omit=dev

# Install backend deps (@supabase/supabase-js, etc.)
WORKDIR /app/backend
COPY backend/package*.json ./
RUN npm ci --omit=dev

# Copy backend source
WORKDIR /app
COPY backend/ ./backend/

# Copy built frontend from stage 1
COPY --from=frontend /app/apps/simulator/dist/ ./apps/simulator/dist/

EXPOSE 3000

ENV NODE_ENV=production
ENV APP_ENV=production

CMD ["node", "backend/server.js"]
