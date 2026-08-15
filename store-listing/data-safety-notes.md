# Play Console "Data safety" form — answers to use

Google's Data Safety questionnaire changes wording periodically — verify against the live form, but based on what's actually in the app today (see `src/lib/storage.ts`, `src/api/tmdb.ts`, `src/api/omdb.ts`, no analytics/crash/ads SDKs in `package.json`):

## Does your app collect or share any of the required user data types?

**No** — is the accurate answer for data the *developer* collects. WalkerLab has no backend, no analytics SDK, and no ad SDK on Android. Everything the app stores (server URLs/credentials, preferences) stays on-device in encrypted secure storage and is never sent to the developer.

## Data shared with third parties (TMDB / OMDb)

The app does make direct network requests to TMDB and OMDb from the user's device for movie/show metadata and posters — no account info, credentials, or server data is included in these requests, just search/lookup queries (e.g. a title being searched, or a TMDB/IMDb id).

Play's form asks this from the angle of "data the app collects and shares," not general internet requests a client makes — most comparable metadata/lookup clients answer **"No data collected"** here, since no personally-identifiable data is being transmitted, only ordinary API lookups. If Play's current UI has a narrower carve-out for this, it's worth reading their latest data-safety help docs before submitting, since this section is the one most likely to trip up automated review.

## Encryption in transit

- Answer **yes** if asked whether data is encrypted in transit for the app's own network calls: TMDB/OMDb are HTTPS-only. Whether the user's own Sonarr/Radarr/etc. connections are encrypted depends on their setup (this app explicitly supports plain `http://` for LAN-hosted services — see `plugins/withCleartextTraffic.js`) — data between the device and the *user's own* server is under their control, not something the app can guarantee end-to-end.

## Data deletion

There's no account to delete data from — all app data is local device storage, removed by uninstalling the app or clearing app data in Android settings. No developer-side deletion request flow is needed since nothing is stored server-side.

## Permissions the app requests (for context, not literally part of this form)

- **Internet** — to reach the servers you configure and TMDB/OMDb.
- **Notifications (`POST_NOTIFICATIONS`)** — for the local download-complete alerts.
- **Background task** (`expo-background-task`) — to periodically check configured servers on a schedule.

None of these correspond to a "personal info," "location," "financial info," "health," "contacts," or "photos/media" data type in Play's taxonomy — the honest answer across nearly all of Play's data-type checkboxes is "not collected."
