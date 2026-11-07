FROM node:24.22.2-alpine AS build
WORKDIR /app
ENV HUSKY=0
COPY package.json package-lock.json ./
COPY scripts/prepare-hooks.mjs ./scripts/prepare-hooks.mjs
RUN npm ci
COPY . .
RUN npm run generate

FROM nginx:stable-alpine AS runtime
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/.output/public /usr/share/nginx/html
EXPOSE 80
