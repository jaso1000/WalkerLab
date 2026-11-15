#!/usr/bin/env bash
# Builds the Windows Server installer (WalkerLab-Server-Setup-<version>.exe):
# the same Node backend + Expo web export the Docker image ships (see
# Dockerfile - this mirrors its three stages), plus a bundled node.exe and
# a WinSW service wrapper, packed by NSIS (windows/installer.nsi). The
# target machine needs nothing preinstalled - no Node, no Docker.
#
# Why not Docker on Windows Server: Windows Server's own Docker only runs
# Windows containers, and this image is Linux (node:alpine). The backend is
# plain Node with no native modules, so it runs natively on Windows as-is;
# only the data dir needs pointing somewhere Windows-shaped (the server
# defaults WALKERLAB_DATA_DIR to /data - the installer sets it explicitly).
#
# Always builds from a committed git ref (`git archive`), never the working
# tree, so uncommitted work-in-progress can't leak into a release build.
#
# Runs on Linux. Needs node/npm, git, curl, unzip, makensis (Debian/Ubuntu:
# `apt install nsis`; the CI workflow .github/workflows/windows-installer.yml
# does exactly that), and optionally ImageMagick for the installer icon.
#
# Usage:
#   scripts/build-windows-installer.sh <version> [git-ref]   # e.g. 2.11.0
#   STAGE_ONLY=1 scripts/build-windows-installer.sh <version> # stop before makensis
set -euo pipefail

VERSION="${1:-}"
REF="${2:-HEAD}"
if [[ ! "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "Usage: $0 <version x.y.z> [git-ref]" >&2
  exit 1
fi

# Pinned downloads, verified by SHA-256 before use. Bump both together.
NODE_VERSION="24.22.3"
NODE_SHA256="e612af99f626ab415ea225af6bce5c971feb448cb5cae250bb1c3fa50c5f7d9f"
# WinSW .NET Framework 4.6.1 build: ~650 KB, and every supported Windows
# Server (2016+) ships .NET Framework 4.6+ in-box - the self-contained
# WinSW-x64.exe is 18 MB for no practical gain here.
WINSW_VERSION="2.12.0"
WINSW_SHA256="b5066b7bbdfba1293e5d15cda3caaea88fbeab35bd5b38c41c913d492aadfc4f"

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="$REPO_DIR/dist-windows"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
SRC="$WORK/src"
STAGE="$WORK/stage"
DL="$WORK/dl"
mkdir -p "$SRC" "$STAGE/app" "$STAGE/node" "$DL" "$OUT_DIR"

if [[ -z "${STAGE_ONLY:-}" ]] && ! command -v makensis >/dev/null; then
  echo "makensis not found - install NSIS (apt install nsis) or run with STAGE_ONLY=1." >&2
  exit 1
fi

echo "== Exporting $REF from git =="
git -C "$REPO_DIR" archive --format=tar "$REF" | tar -x -C "$SRC"

echo "== Expo web export =="
(cd "$SRC" && npm ci --no-audit --no-fund && npx expo export -p web)

echo "== Backend build =="
(cd "$SRC/server" && npm ci --no-audit --no-fund && npm run build)
cp -r "$SRC/server/dist" "$STAGE/app/dist"
cp "$SRC/server/package.json" "$SRC/server/package-lock.json" "$STAGE/app/"
(cd "$STAGE/app" && npm ci --omit=dev --no-audit --no-fund)
# Production deps are installed here on Linux and shipped to Windows as-is,
# which is only safe while none of them carry a compiled native addon.
if find "$STAGE/app/node_modules" -name '*.node' | grep -q .; then
  echo "A production dependency ships a native .node addon - it can't be built on Linux for Windows:" >&2
  find "$STAGE/app/node_modules" -name '*.node' >&2
  exit 1
fi
cp -r "$SRC/dist" "$STAGE/app/public"

echo "== Fetching Node $NODE_VERSION (win-x64) and WinSW $WINSW_VERSION =="
NODE_ZIP="node-v$NODE_VERSION-win-x64.zip"
curl -fsSL -o "$DL/$NODE_ZIP" "https://nodejs.org/dist/v$NODE_VERSION/$NODE_ZIP"
curl -fsSL -o "$DL/winsw.exe" "https://github.com/winsw/winsw/releases/download/v$WINSW_VERSION/WinSW.NET461.exe"
(cd "$DL" && printf '%s  %s\n%s  %s\n' "$NODE_SHA256" "$NODE_ZIP" "$WINSW_SHA256" winsw.exe | sha256sum -c --quiet)
unzip -q -j "$DL/$NODE_ZIP" "node-v$NODE_VERSION-win-x64/node.exe" "node-v$NODE_VERSION-win-x64/LICENSE" -d "$STAGE/node"
cp "$DL/winsw.exe" "$STAGE/WalkerLabService.exe"
cp "$SRC/LICENSE" "$STAGE/LICENSE"

if [[ -n "${STAGE_ONLY:-}" ]]; then
  rm -rf "$OUT_DIR/stage"
  cp -r "$STAGE" "$OUT_DIR/stage"
  echo "== Staged (no installer built): $OUT_DIR/stage =="
  exit 0
fi

NSIS_ARGS=(-V2 -WX -DVERSION="$VERSION" -DSTAGE="$STAGE" -DOUTFILE="$OUT_DIR/WalkerLab-Server-Setup-$VERSION.exe")
MAGICK="$(command -v magick || command -v convert || true)"
if [[ -n "$MAGICK" ]]; then
  "$MAGICK" "$SRC/assets/walkerlab-icon.png" -define icon:auto-resize=128,64,48,32,16 "$WORK/walkerlab.ico"
  NSIS_ARGS+=(-DICON="$WORK/walkerlab.ico")
fi

echo "== Building installer =="
makensis "${NSIS_ARGS[@]}" "$SRC/windows/installer.nsi"
(cd "$OUT_DIR" && sha256sum "WalkerLab-Server-Setup-$VERSION.exe" | tee "WalkerLab-Server-Setup-$VERSION.exe.sha256")
echo "== Done: $OUT_DIR/WalkerLab-Server-Setup-$VERSION.exe =="
