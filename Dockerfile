# WalkerLab Docker/web build - serves the Expo web export behind the
# Node backend (server/), which holds every service credential encrypted
# at rest and proxies every service call server-side. See PLAN.md's
# "Docker / Web deployment" section for the full architecture and why this
# needs a real backend at all (a browser reaching this over a cloud tunnel
# can't reach the user's home-LAN Sonarr/Radarr/etc. directly - the
# container has to make those calls itself).

# Node 24 (not 20) since Expo SDK 57: SDK 57 requires Node ^20.19.4 /
# ^22.13 / ^24.3, and node:20-alpine does satisfy that on version alone -
# but it bundles npm 10, which resolves the dependency tree differently
# than the npm 11 that writes this repo's package-lock.json. `npm ci` then
# fails the sync check ("lock file's ws@7.5.13 does not satisfy ws@8.21.1")
# even though the lockfile is correct and in sync locally. node:24-alpine
# ships npm 11, matching whatever regenerates the lockfile on a dev machine.

# --- Stage 1: Expo web export ------------------------------------------------
FROM node:24-alpine AS web-build
WORKDIR /app
# `.npmrc` must be copied alongside the manifests, not just with the rest of
# the source below: it sets `legacy-peer-deps=true`, which is the mode this
# repo's package-lock.json is generated under. Without it here, `npm ci`
# resolves peer dependencies strictly, computes a different ideal tree than
# the lockfile encodes, and aborts with "can only install packages when your
# package.json and package-lock.json are in sync" - listing packages as
# missing that are in fact resolvable. Survived SDK 54 by luck; SDK 57's
# dependency graph makes the difference load-bearing.
COPY package.json package-lock.json .npmrc ./
RUN npm ci
COPY . .
RUN npx expo export -p web

# --- Stage 2: backend build ---------------------------------------------------
FROM node:24-alpine AS server-build
WORKDIR /app/server
COPY server/package.json server/package-lock.json ./
RUN npm ci
COPY server/ .
RUN npm run build

# --- Stage 3: slim runtime ----------------------------------------------------
FROM node:24-alpine
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
