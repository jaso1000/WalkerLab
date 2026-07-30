#!/bin/sh
# Fixes /data's ownership to the unprivileged `node` user before dropping
# root, then execs the real command as that user. Needed on every start, not
# just first boot: a fresh named volume is created owned by root by Docker
# itself, and an existing volume from before this image ran as non-root
# already has its encrypted store/key files owned by root too - either way,
# the `node` user (see the USER-less Dockerfile note) can't read them without
# this. Cheap to always run - this directory only ever holds two small files.
set -e
chown -R node:node /data
exec su-exec node "$@"
