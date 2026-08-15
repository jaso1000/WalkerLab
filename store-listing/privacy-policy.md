# WalkerLab Privacy Policy

**Last updated: August 14, 2026**

WalkerLab is a remote-control client for self-hosted media server software (Sonarr, Radarr, SABnzbd, qBittorrent, Overseerr, Tautulli, and Portainer). This policy explains what data the Android app handles and where it goes.

## The short version

WalkerLab has no backend server of its own on Android and no user account system. The app does not collect, transmit, or sell any of your data to the developer or to any third party for advertising, analytics, or any other purpose. The only network connections the app makes are the ones you configure — directly to the servers you tell it to connect to, and to two third-party metadata providers described below.

## What the app stores, and where

- **Your server addresses and credentials** (URLs, API keys, usernames/passwords for Sonarr, Radarr, SABnzbd, qBittorrent, Overseerr, Tautulli, Portainer) are stored only on your device, in Android's encrypted secure storage. They are never transmitted to the developer or to any server other than the one they belong to.
- **App preferences** (which sections are enabled, sort order, tab layout, and similar settings) are stored only on your device.
- **Server Profile backups**, if you create one, are encrypted on your device with a passphrase you choose before being handed to Android's own Share sheet. WalkerLab never sees or stores a copy.

## Third-party services the app talks to directly

- **The Movie Database (TMDB)** and **OMDb** — used to show posters, artwork, and ratings in the Discover section. Your device contacts these services directly to fetch this metadata. Standard network information (such as your IP address) is visible to them as it would be for any app or website you use; see [TMDB's privacy policy](https://www.themoviedb.org/privacy-policy) and [OMDb's terms](https://www.omdbapi.com/) for how they handle that. WalkerLab does not send them your name, email, or any server credentials.
- **The media server(s) you configure** — Sonarr, Radarr, SABnzbd, qBittorrent, Overseerr, Tautulli, and/or Portainer, hosted by you or someone you trust. All library, download, and playback data shown in the app comes from these servers directly. WalkerLab does not proxy, log, or retain a copy of this data anywhere else.

## Notifications

On Android, WalkerLab checks the servers you've configured on a schedule you control and shows a local notification when something new is found. This happens entirely on your device — no push token is registered with any server, and no notification content passes through the developer or any third party.

## What the app does not do

- No account creation or login with WalkerLab itself.
- No analytics, crash reporting, or advertising SDKs.
- No data is sold or shared with third parties for marketing purposes.
- No location data is collected.

## Children's privacy

WalkerLab is not directed at children and does not knowingly collect data from children.

## Changes to this policy

If this policy changes, the "Last updated" date above will change and the new version will be posted at the same address.

## Contact

Questions about this policy can be sent to **walker.jason18@gmail.com**.
