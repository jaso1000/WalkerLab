# WalkerLab Docker/web build - serves the Expo web export behind the
# Node backend (server/), which holds every service credential encrypted
# at rest and proxies every service call server-side. See PLAN.md's
# "Docker / Web deployment" section for the full architecture and why this
# needs a real backend at all (a browser reaching this over a cloud tunnel
# can't reach the user's home-LAN Sonarr/Radarr/etc. directly - the
# container has to make those calls itself).

# --- Stage 1: Expo web export ------------------------------------------------
FROM node:20-alpine AS web-build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npx expo export -p web

# --- Stage 2: backend build ---------------------------------------------------
FROM node:20-alpine AS server-build
WORKDIR /app/server
COPY server/package.json server/package-lock.json ./
RUN npm ci
COPY server/ .
RUN npm run build

# --- Stage 3: slim runtime ----------------------------------------------------
FROM node:20-alpine
# su-exec drops from root to the `node` user after docker-entrypoint.sh fixes
# up /data's ownership - see that script for why this can't just be a
# top-level `USER node` instead.
RUN apk add --no-cache su-exec
WORKDIR /app
COPY --from=server-build /app/server/package.json /app/server/package-lock.json ./
RUN npm ci --omit=dev
COPY --from=server-build /app/server/dist ./dist
COPY --from=web-build /app/dist ./public
RUN chown -R node:node /app

ENV PORT=3000
EXPOSE 3000
VOLUME /data

COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "dist/index.js"]
