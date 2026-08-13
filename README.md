<picture>
  <source media="(prefers-color-scheme: dark)" srcset="./assets/branding/walkerlab-lockup-dark.png#gh-dark-mode-only">
  <img alt="WalkerLab" src="./assets/branding/walkerlab-lockup-light.png#gh-light-mode-only">
</picture>

# WalkerLab

**Walk your stack with ease.**

A cross-platform (iOS + Android + Docker/web) app for managing your home media server stack — Sonarr, Radarr, Lidarr, SABnzbd/NZBGet, qBittorrent, Overseerr, Tautulli, and Portainer — all in one place, plus a Discover tab (TMDB/OMDb for movies & TV, Last.fm for music) for browsing and requesting new movies, shows, and artists. Supports multiple isolated server profiles with encrypted backup/restore, so one install can manage more than one stack. Self-hosted by design — your credentials, your infrastructure, nothing routed through a third party. The Docker/web build supports multiple user accounts too, each with their own independent set of profiles, managed by a single admin.

## Features

- **Discover** — search and browse movies, TV, and music, see what's trending, popular, upcoming, or newly released, and add straight to your library in one tap. Movie/TV detail pages include cast & crew, ratings from IMDb/Rotten Tomatoes/Metacritic/TMDB, similar-title recommendations, and where a title is currently streaming in your region. Music Discover (powered by Last.fm) surfaces top artists, new releases, and genre browsing, with artist bios and similar-artist recommendations.
- **TV Shows & Movies** (Sonarr/Radarr) — browse your library, drill into seasons and episodes, monitor or search for missing content, view file quality, and manage what's downloaded.
- **Music** (Lidarr) — browse your artist library, drill into albums and tracks, monitor or search for missing releases, and add new artists straight from Discover.
- **Downloads & Torrents** (SABnzbd, NZBGet, and qBittorrent) — live queue and history, with pause/resume/delete and real-time progress. SABnzbd and NZBGet each get their own section, independently enabled — most setups only run one, but nothing stops you from enabling both.
- **Requests** (Overseerr) — review, approve, or decline requests from the people you share your server with.
- **Stats** (Tautulli) — see what's playing on Plex right now, who's watching, and library-wide watch history and trends.
- **Containers** (Portainer) — start, stop, restart, or recreate any container in your Docker stack, right from the app.
- **Server Profiles** — manage more than one server stack from a single install, each fully isolated, with encrypted backup and restore.
- **Self-hosted web option** — run WalkerLab as its own Docker container with a secure admin login, so you can manage your stack remotely without exposing your other services directly to the internet.
- **Multi-user (Docker/web)** — the admin can create additional accounts from Settings, each with their own completely independent set of Server Profiles on the same shared instance.
- **Push Notifications** — get notified when a new episode, movie, or album finishes downloading, or a new request comes in, with a per-service on/off toggle. On the Docker/web build, real push notifications are relayed straight from your own server — one tap auto-configures Sonarr/Radarr/Lidarr/Overseerr's webhooks for you. On Android, the app checks your services directly on an interval you choose, so nothing needs to be hosted just to get notified.

## Tech Stack

- [Expo](https://expo.dev) (SDK 57) + React Native + TypeScript, [Expo Router](https://docs.expo.dev/router/introduction/)
- On iOS/Android, talks directly to the Sonarr, Radarr, Lidarr, SABnzbd, NZBGet, qBittorrent, Overseerr, TMDB, OMDb, Last.fm, Tautulli, and Portainer APIs, plus Apple's keyless iTunes Search/Marketing Tools endpoints for Music Discover cover art and new releases
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

or without compose:

```bash
docker run -d \
  --name walkerlab \
  -p 3000:3000 \
  -v walkerlab-data:/data \
  --restart unless-stopped \
  ghcr.io/jaso1000/walkerlab:latest
```

Open the container's address in a browser — the first visit walks you through a setup wizard to create your admin account, then you configure each service under Settings, same as on mobile. Every credential is encrypted at rest server-side and never touches the browser directly. From Settings > Manage Users, the admin can add accounts for anyone else who needs access — each one gets their own independent set of Server Profiles. See [`docker-compose.yml`](docker-compose.yml) for optional environment variables (seeding an admin account, supplying your own encryption key).

### Option 3: Build from source

```bash
npm install
npx expo start
```

Scan the QR code with [Expo Go](https://expo.dev/go) (Android or iOS), or press `a` / `i` for an emulator/simulator.

---

However you install it, open **Settings** and add your services' URLs and credentials to get started.
