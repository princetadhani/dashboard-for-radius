#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Accept first arg as the image tar.gz, else auto-find one next to this script.
IMAGE_FILE="${1:-}"
if [[ -z "$IMAGE_FILE" ]]; then
  IMAGE_FILE="$(ls "$SCRIPT_DIR"/radius-dashboard-*.tar.gz 2>/dev/null | head -n1 || true)"
fi

if [[ -z "$IMAGE_FILE" || ! -f "$IMAGE_FILE" ]]; then
  echo "Usage: $0 <path/to/radius-dashboard-<tag>.tar.gz>" >&2
  echo "Or place the .tar.gz next to this script and run with no args." >&2
  exit 1
fi

echo ">> Loading $IMAGE_FILE"
gunzip -c "$IMAGE_FILE" | docker load

echo ">> Done."
docker images | head -n5
