# Build stage: compile the SPA. No secrets are passed in; the browser never sees server keys.
FROM node:22-alpine AS build
WORKDIR /srv/frontend
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npx tsc -b && npx vite build

# Serve stage: static files + /api proxy handled by nginx.
FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /srv/frontend/dist /usr/share/nginx/html
EXPOSE 8080
