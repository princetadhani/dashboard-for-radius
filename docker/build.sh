#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

IMAGE_NAME="${IMAGE_NAME:-radius-dashboard}"
IMAGE_TAG="${IMAGE_TAG:-latest}"

cd "$REPO_ROOT"

echo ">> Building $IMAGE_NAME:$IMAGE_TAG"
docker build -t "$IMAGE_NAME:$IMAGE_TAG" .

echo ">> Done."
docker images "$IMAGE_NAME:$IMAGE_TAG"
