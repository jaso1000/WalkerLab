<picture>
  <source media="(prefers-color-scheme: dark)" srcset="./assets/branding/walkerlab-lockup-dark.png#gh-dark-mode-only">
  <img alt="WalkerLab" src="./assets/branding/walkerlab-lockup-light.png#gh-light-mode-only">
</picture>

# WalkerLab

**Walk your stack with ease.**

A cross-platform (iOS + Android + Docker/web) app for managing your home media server stack — Sonarr, Radarr, SABnzbd, qBittorrent, Overseerr, Tautulli, and Portainer — all in one place, plus a TMDB/OMDb-powered Discover tab for browsing and requesting new movies and shows. Supports multiple isolated server profiles with encrypted backup/restore, so one install can manage more than one stack. Self-hosted and single-admin by design — your credentials, your infrastructure, nothing routed through a third party.

## Features

- **Discover** — search and browse movies & TV, see what's trending, popular, or upcoming, and add straight to your library in one tap. Detail pages with cast & crew, ratings from IMDb/Rotten Tomatoes/Metacritic/TMDB, and similar-title recommendations.
- **TV Shows & Movies** (Sonarr/Radarr) — browse your library, drill into seasons and episodes, monitor or search for missing content, view file quality, and manage what's downloaded.
- **Downloads & Torrents** (SABnzbd/qBittorrent) — live queue and history, with pause/resume/delete and real-time progress.
- **Requests** (Overseerr) — review, approve, or decline requests from the people you share your server with.
- **Stats** (Tautulli) — see what's playing on Plex right now, who's watching, and library-wide watch history and trends.
- **Containers** (Portainer) — start, stop, restart, or recreate any container in your Docker stack, right from the app.
- **Server Profiles** — manage more than one server stack from a single install, each fully isolated, with encrypted backup and restore.
- **Self-hosted web option** — run WalkerLab as its own Docker container with a secure admin login, so you can manage your stack remotely without exposing your other services directly to the internet.

## Tech Stack

- [Expo](https://expo.dev) (SDK 54) + React Native + TypeScript, [Expo Router](https://docs.expo.dev/router/introduction/)
- On iOS/Android, talks directly to the Sonarr, Radarr, SABnzbd, qBittorrent, Overseerr, TMDB, OMDb, Tautulli, and Portainer APIs
- The Docker/web build adds a small Express + TypeScript backend (`server/`) that proxies every service call and stores credentials encrypted at rest — see [Installation](#installation) below

## Installation

Pick whichever fits how you want to run it — all three talk to the same services and share the same feature set.

### Option 1: Android APK

Download the latest APK from [Releases](../../releases/latest) and side-load it onto your device. No Play Store listing (yet) — you'll need to allow installs from unknown sources.

### Option 2: Docker (self-hosted web)

Run it as a container on the same machine/network as your media stack (it needs to reach Sonarr/Radarr/etc. directly), then put a reverse proxy or tunnel of your choice in front of it for remote access:

```bash
docker compose up -d
```

or without compose (a prebuilt image isn't published yet, so build it locally first):

```bash
docker build -t walkerlab .
docker run -d \
  --name walkerlab \
  -p 3000:3000 \
  -v walkerlab-data:/data \
  --restart unless-stopped \
  walkerlab
```

Open the container's address in a browser — the first visit walks you through a setup wizard to create your admin account, then you configure each service under Settings, same as on mobile. Every credential is encrypted at rest server-side and never touches the browser directly. See [`docker-compose.yml`](docker-compose.yml) for optional environment variables (seeding an admin account, supplying your own encryption key).

### Option 3: Build from source

```bash
npm install
npx expo start
```

Scan the QR code with [Expo Go](https://expo.dev/go) (Android or iOS), or press `a` / `i` for an emulator/simulator.

---

However you install it, open **Settings** and add your services' URLs and credentials to get started.
