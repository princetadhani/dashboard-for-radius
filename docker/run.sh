#!/usr/bin/env bash
set -euo pipefail

IMAGE_NAME="${IMAGE_NAME:-radius-dashboard}"
IMAGE_TAG="${IMAGE_TAG:-latest}"
CONTAINER_NAME="${CONTAINER_NAME:-radius-dashboard}"
HOST_PORT="${HOST_PORT:-80}"
DATA_DIR="${DATA_DIR:-$(pwd)/data}"

mkdir -p "$DATA_DIR"

# If a container with this name already exists (running or stopped), remove it.
if docker ps -a --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
  echo ">> Removing existing container '$CONTAINER_NAME'"
  docker rm -f "$CONTAINER_NAME" >/dev/null
fi

echo ">> Starting $CONTAINER_NAME from $IMAGE_NAME:$IMAGE_TAG"
echo ">> Host port:    $HOST_PORT  ->  container :80"
echo ">> Data dir:     $DATA_DIR  ->  /app/data"

docker run -d \
  --name "$CONTAINER_NAME" \
  --restart unless-stopped \
  -p "${HOST_PORT}:80" \
  -v "${DATA_DIR}:/app/data" \
  "$IMAGE_NAME:$IMAGE_TAG"

echo ">> Done."
echo ">> Open: http://localhost:${HOST_PORT}/  (or http://<this-host-ip>:${HOST_PORT}/ from another machine)"
echo ">> Logs: docker logs -f $CONTAINER_NAME"
