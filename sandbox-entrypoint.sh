#!/bin/sh
# Docker sandbox entrypoint for MulmoClaude.
#
# Runs as root to perform two setup steps that require elevated
# privileges, then drops to the host user's UID:GID via setpriv
# (part of util-linux, already in node:22-slim — no extra install).
#
# Why not just `--user ${UID}:${GID}`?
#   That flag runs the ENTIRE container (including this entrypoint)
#   as the non-root user, which prevents writing to /etc/passwd and
#   fixing socket permissions. The entrypoint-then-drop pattern is
#   the standard Docker solution for "I need root setup but non-root
#   runtime". See #259 for the full motivation.

set -e

TARGET_UID="${HOST_UID:-1000}"
TARGET_GID="${HOST_GID:-1000}"

# 1. Add a /etc/passwd entry for the target UID if it doesn't exist.
#    SSH refuses to operate when the running user has no passwd entry
#    ("No user exists for uid NNN"). On macOS the host UID is
#    typically 501, which isn't in the container's passwd (only root=0
#    and node=1000 are).
if ! getent passwd "$TARGET_UID" > /dev/null 2>&1; then
  echo "sandbox:x:${TARGET_UID}:${TARGET_GID}::/home/node:/bin/sh" >> /etc/passwd
fi

# 2. Make the SSH agent socket accessible to the target user.
#    Docker Desktop for Mac's magic socket (/run/host-services/
#    ssh-auth.sock) is created as root:root mode 660. The target UID
#    (e.g. 501) has no group membership to read it. A broad chmod is
#    acceptable here because we're inside an isolated container with
#    --cap-drop ALL — there's no other user to protect against.
if [ -S "${SSH_AUTH_SOCK:-}" ]; then
  chmod 666 "$SSH_AUTH_SOCK" 2>/dev/null || true
fi

# 3. Drop privileges and exec the actual command (typically `claude`).
#    setpriv is part of util-linux, already present in node:22-slim.
#    --init-groups initialises supplementary groups from /etc/group.
exec setpriv --reuid="$TARGET_UID" --regid="$TARGET_GID" --init-groups -- "$@"
