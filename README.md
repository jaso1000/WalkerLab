<picture>
  <source media="(prefers-color-scheme: dark)" srcset="./assets/branding/walkerlab-lockup-dark.png#gh-dark-mode-only">
  <img alt="WalkerLab" src="./assets/branding/walkerlab-lockup-light.png#gh-light-mode-only">
</picture>

# WalkerLab

**Walk your stack with ease.**

A cross-platform (iOS + Android + Docker/web) app for managing your home media server stack — Sonarr, Radarr, SABnzbd, qBittorrent, Overseerr, Tautulli, and Portainer — all in one place, plus a TMDB/OMDb-powered Discover tab for browsing and requesting new movies and shows. Supports multiple isolated server profiles with encrypted backup/restore, so one install can manage more than one stack. Self-hosted and single-admin by design — your credentials, your infrastructure, nothing routed through a third party.

## Features

### Discover (TMDB + OMDb)
- Universal search across movies and TV, with a quick-add button that adds using your last-used quality profile and first root folder
- Recently Added (sorted by Radarr/Sonarr's own added date), Trending, Popular, Upcoming, and Recently Released rows — each opens a full infinite-scroll grid, with a release-type filter (Theatrical/Digital/Physical) on Recently Released
- Browse by Network (TV)
- Poster badges for what's already in your library, downloaded, or previously removed
- **Detail page**: add-to-library flow, cast & crew (cast, directors, and writers are all tappable through to a filmography page with profile photos, sorted by rating/popularity), tags, a combined ratings strip (IMDb/Rotten Tomatoes/Metacritic/TMDB, each tappable out to its source), release-date triptych, "More Like This", and a "previously removed" banner

### TV Shows (Sonarr)
- Library list with poster, episode-count badge, and storage size on disk
- Swipeable tabs: **All**, **Missing**, **Upcoming** (calendar), **Activity**, **History**, **Server**
- Persistent search bar and a sort/group menu (Title, Year, Date Added, Size, Quality Profile, Genre)
- Distinct status colors (continuing/ended/upcoming), a "Downloaded" badge on Upcoming rows that already have a file
- **Series detail page**: hero art, monitored toggle, cast & crew, tags, production country, per-season list, synopsis
- **Season → episode drill-down**: multi-select with a bulk action bar (search / monitor / unmonitor / delete files), full file tech-details
- **Add Series**: opens the same rich Discover detail page used for browsing, with a Monitor picker (All/Future/Missing/Existing Episodes/Pilot/First-or-Latest-Season/None) matching Sonarr's own add screen
- **Interactive search**: browse and manually pick a release instead of letting Sonarr auto-grab
- Remove from Library with a keep-or-delete-files prompt

### Movies (Radarr)
- Same shape as TV Shows: library list, All/Missing/Upcoming/Activity/History/Server tabs, search + sort/group (plus Digital Release, Rating, Popularity, Studio)
- Upcoming releases stay visible for the entire day they release, with a "Downloaded" badge once grabbed, instead of disappearing once the exact release time passes
- **Movie detail page**: hero art, full file tech-details (resolution, codec, HDR, bitrate, fps, audio), Theatrical/Digital/Physical release dates, cast & crew, tags, ratings
- **Add Movie**: opens the Discover detail page for the full browsing experience
- Interactive release search, Remove from Library with keep-or-delete-files

### Downloads (SABnzbd)
- Live **Queue** view (polls every 3s) with per-item progress, status, time remaining, reorder, and a pause/resume/delete menu
- **History** tab for completed/failed downloads, with failure messages shown inline
- Live aggregate download speed

### Torrents (qBittorrent)
- Swipeable tabs: **All**, **Active**, **Downloading**, **Finished**, **Error**
- Per-torrent progress, download/upload speed, ratio, and ETA, with a pause/resume/delete menu (delete offers "remove only" or "remove + delete files")
- Live polling while the screen is open

### Requests (Overseerr, shown as "Seer")
- **Pending** tab by default, plus an **All** tab with status filter chips (Approved/Processing/Available/Failed)
- Requests enriched with poster/title via TMDB
- Approve, decline, or delete a request from a single action sheet

### Stats (Tautulli)
- **Activity**: what's playing on Plex right now, live (polls every 3s) — poster, title, who's watching, playback progress, and a transcode-decision badge with the source quality and, when it's actually transcoding, exactly what it's being converted to
- **Users**: every Plex user with avatar, total play count, and total watch time — tap through to that user's individual watch history
- **History**: infinite-scroll list of past playback with poster, title, who watched it, and how far they got, including the exact watch date and time
- **Stats**: ranked lists for Most Watched Movies, Most Popular Movies/Shows, Most Active Users, and Most Concurrent Streams, each with a poster or avatar
- **Graphs**: plays-over-time trends by day, day of week, and month

### Containers (Portainer)
- **Containers** tab: every Docker container Portainer manages, with a status badge (health status like "healthy" takes precedence over the raw run state when a healthcheck is configured) and its stack name if it belongs to one — persistent search bar and a sort menu (Name, State, Created)
- Long-press a container for quick actions: Start, Stop, Kill, Restart, Pause, Resume, Remove, and Recreate (with an optional pull-latest-image step) — only the actions that make sense for its current state are shown
- **Container detail page**: status, uptime ("Running for 15 days"), stack, image, created date, IP address, published ports (tap to open), ownership, the full action set, and a link out to Portainer's own web UI
- **Stacks** tab: every stack with its type (Compose/Swarm) and active/inactive status — tap through to start/stop the whole stack and see its member containers
- Supports self-signed HTTPS certificates (the default for most local Portainer installs): on a failed connection, the app can inspect the server's actual certificate and, after you review its fingerprint and explicitly approve it, pin to that exact certificate for future connections

### Settings
- A simple services list — tap into any service for its own page with a description, common URL/port examples, and connection fields (server URL + API key, or username/password for qBittorrent's session-based login, with an optional API-key header for reverse-proxy setups)
- Rename any section's label in the drawer and page header right from that service's settings page (Settings itself can't be renamed)
- Pick which section opens when the app launches
- Credentials stored securely on-device (`expo-secure-store`) on iOS/Android; on the Docker/web build, credentials never touch the browser at all — they're encrypted at rest server-side and every request is proxied through the backend (see Docker / Web below)

### Server Profiles
- Switch between multiple fully-isolated profiles from a menu at the bottom of the drawer — each profile has its own service credentials, drawer renames, enabled/hidden sections, and startup screen, and switching live-reloads the whole app with no restart needed
- **Backup**: passphrase-encrypts a profile's full configuration (AES-256-CBC/PBKDF2) into a shareable code
- **Restore**: paste a backup code and passphrase to recreate a profile — always creates a new profile, never overwrites an existing one

### Docker / Web
- Run the whole app as a self-hosted web container instead of (or alongside) the mobile apps — confirmed working through a real Cloudflare Tunnel exposing it to the public internet, not just on the local network
- A single-admin login gates the whole instance, with an in-app first-run setup wizard on a fresh container (no config-file editing needed to get started)
- Every service credential is encrypted at rest and never sent to the browser — the container makes every Sonarr/Radarr/SABnzbd/qBittorrent/Overseerr/Tautulli/Portainer call itself, which is also what makes remote access actually work (a browser reaching the app from outside your home network can't reach those services directly, tunnel or not — the container, running on your home network, can)
- Hardened for public-internet exposure: rate limiting on login, security headers (HSTS, clickjacking protection, etc.), and the container runs as a non-root user
- Portainer's self-signed-certificate trust flow works the same way as the native apps, just implemented server-side instead of through a native Android module

### Everywhere else
- Responsive 1/2/3-column layout on TV Shows, Movies, Downloads, Torrents, Requests, and Containers so foldables and tablets use the extra width instead of stretching a single column
- Animated sliding tab indicator that auto-scrolls to keep the active tab in view
- No real service logos anywhere (copyright) — colored icons and brand-color accents instead

## Tech Stack

- [Expo](https://expo.dev) (SDK 54) + React Native + TypeScript
- [Expo Router](https://docs.expo.dev/router/introduction/) for file-based navigation
- On iOS/Android, talks directly to the Sonarr v3, Radarr v3, SABnzbd, qBittorrent WebUI, Overseerr v1, TMDB v3, OMDb, Tautulli v2, and Portainer REST APIs — no backend server required
- The Docker/web build adds a small Express + TypeScript backend (`server/`) that proxies every service call and stores credentials encrypted at rest (AES-256-GCM) — see [Docker / Web](#docker--web) above and [Installation](#installation) below

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
