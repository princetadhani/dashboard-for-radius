#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

IMAGE_NAME="${IMAGE_NAME:-radius-dashboard}"
IMAGE_TAG="${IMAGE_TAG:-latest}"
OUT_DIR="${OUT_DIR:-$REPO_ROOT/dist-docker}"

mkdir -p "$OUT_DIR"
OUT_FILE="$OUT_DIR/${IMAGE_NAME}-${IMAGE_TAG}.tar.gz"

echo ">> Saving $IMAGE_NAME:$IMAGE_TAG -> $OUT_FILE"
docker save "$IMAGE_NAME:$IMAGE_TAG" | gzip -c > "$OUT_FILE"

ls -lh "$OUT_FILE"
echo ">> Done."
