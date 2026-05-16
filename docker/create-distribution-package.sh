#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

IMAGE_NAME="${IMAGE_NAME:-radius-dashboard}"
IMAGE_TAG="${IMAGE_TAG:-latest}"
DIST_NAME="${DIST_NAME:-radius-dashboard-distribution}"
OUT_DIR="${OUT_DIR:-$REPO_ROOT/dist-docker}"

STAGING="$OUT_DIR/$DIST_NAME"
ARCHIVE="$OUT_DIR/${DIST_NAME}.tar.gz"

# 1. Ensure the image exists, building if needed.
if ! docker image inspect "$IMAGE_NAME:$IMAGE_TAG" >/dev/null 2>&1; then
  echo ">> Image $IMAGE_NAME:$IMAGE_TAG not found locally. Building."
  "$SCRIPT_DIR/build.sh"
fi

# 2. Save the image.
echo ">> Exporting image"
"$SCRIPT_DIR/save-image.sh"

# 3. Stage the distribution directory.
rm -rf "$STAGING"
mkdir -p "$STAGING"
cp "$OUT_DIR/${IMAGE_NAME}-${IMAGE_TAG}.tar.gz" "$STAGING/"
cp "$SCRIPT_DIR/load-image.sh" "$STAGING/"
cp "$SCRIPT_DIR/run.sh"        "$STAGING/"
chmod +x "$STAGING/load-image.sh" "$STAGING/run.sh"

cat > "$STAGING/README.md" <<EOF
# Radius Dashboard — Docker distribution

Self-contained image. Works on any Linux/macOS host with Docker installed —
no source code, no \`.env\` files, no config edits.

## One-time setup

\`\`\`bash
./load-image.sh        # imports the included image .tar.gz into Docker
./run.sh               # starts the container, port 80, auto-restart on reboot
\`\`\`

Then open **http://localhost/** (or **http://<this-host-ip>/** from another
machine on the LAN).

## Persistence

A \`data/\` directory is created next to \`run.sh\` and mounted into the
container at \`/app/data\`. The SQLite DB lives at \`./data/dev.db\` and
survives \`docker stop\`, \`docker rm\`, and image upgrades.

## Manage

\`\`\`bash
docker ps                       # status
docker logs -f radius-dashboard # tail logs
docker restart radius-dashboard
docker stop radius-dashboard
docker start radius-dashboard
\`\`\`

## Auto-start on host reboot

The container uses \`--restart unless-stopped\`. It will come back up
automatically as long as the Docker daemon does. On Linux, ensure the
daemon is enabled once:

\`\`\`bash
sudo systemctl enable docker
\`\`\`

Docker Desktop (macOS / Windows) starts with the OS by default.

## Override defaults

All env vars supported by the backend are honored if you pass them to
\`docker run\` — e.g. to use a non-default port on the host:

\`\`\`bash
HOST_PORT=8080 ./run.sh
\`\`\`

## Image

- Image:  \`$IMAGE_NAME:$IMAGE_TAG\`
- Built:  $(date -u +"%Y-%m-%dT%H:%M:%SZ")
EOF

# 4. Compress.
echo ">> Packaging $ARCHIVE"
tar -czf "$ARCHIVE" -C "$OUT_DIR" "$DIST_NAME"
rm -rf "$STAGING"

ls -lh "$ARCHIVE"
echo ">> Done. Share: $ARCHIVE"
