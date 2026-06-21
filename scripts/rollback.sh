#!/usr/bin/env bash
set -euo pipefail

TAG="${1:-previous}"
export NIKOBOX_TAG="$TAG"
docker compose up -d --no-build bot web
docker compose ps
