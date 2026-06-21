#!/usr/bin/env bash
set -euo pipefail

PROJECT_NAME="NikoBox"
COMPOSE="docker compose"

log() { printf '\n[%s] %s\n' "$PROJECT_NAME" "$*"; }
fail() { printf '\n[%s] ERROR: %s\n' "$PROJECT_NAME" "$*" >&2; exit 1; }

if [ "$(id -u)" -eq 0 ]; then
  SUDO=""
else
  SUDO="sudo"
fi

need_cmd() { command -v "$1" >/dev/null 2>&1; }

install_apt_package() {
  local pkg="$1"
  if ! dpkg -s "$pkg" >/dev/null 2>&1; then
    log "Installing $pkg"
    $SUDO apt-get install -y "$pkg"
  fi
}

install_base_dependencies() {
  if ! need_cmd apt-get; then
    fail "This installer targets Ubuntu/Debian VPS hosts. Install Docker manually for this OS."
  fi
  log "Updating package index"
  $SUDO apt-get update
  install_apt_package ca-certificates
  install_apt_package curl
  install_apt_package gnupg
  install_apt_package git
}

install_docker() {
  if need_cmd docker && docker compose version >/dev/null 2>&1; then
    log "Docker and Docker Compose are already installed"
    return
  fi

  log "Installing Docker Engine and Compose plugin"
  install_base_dependencies
  $SUDO install -m 0755 -d /etc/apt/keyrings
  if [ ! -f /etc/apt/keyrings/docker.asc ]; then
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg | $SUDO tee /etc/apt/keyrings/docker.asc >/dev/null
    $SUDO chmod a+r /etc/apt/keyrings/docker.asc
  fi
  . /etc/os-release
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu ${VERSION_CODENAME} stable" | \
    $SUDO tee /etc/apt/sources.list.d/docker.list >/dev/null
  $SUDO apt-get update
  $SUDO apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  $SUDO systemctl enable --now docker
}

prepare_env() {
  if [ ! -f .env ]; then
    log "Creating .env from .env.example"
    cp .env.example .env
  fi

  if grep -q "replace_me" .env || grep -q "change_me" .env || grep -q "change_lavalink_password" .env; then
    cat <<'MSG'

NikoBox created .env, but required secrets still need real values:
- DISCORD_TOKEN
- DISCORD_CLIENT_ID
- DASHBOARD_ADMIN_TOKEN
- LAVALINK_PASSWORD

Edit .env, then run ./install.sh again.
MSG
    exit 1
  fi
}

build_and_start() {
  log "Building and starting Docker services"
  $COMPOSE up -d --build
}

wait_for_health() {
  local service="$1"
  local tries="${2:-40}"
  log "Waiting for $service health"
  for _ in $(seq 1 "$tries"); do
    status="$(docker inspect --format='{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "nikobox-$service" 2>/dev/null || true)"
    if [ "$status" = "healthy" ] || [ "$status" = "running" ]; then
      printf '[%s] %s is %s\n' "$PROJECT_NAME" "$service" "$status"
      return 0
    fi
    sleep 3
  done
  docker logs --tail=120 "nikobox-$service" || true
  fail "$service did not become healthy"
}

wait_for_lavalink() {
  log "Waiting for Lavalink HTTP API"
  for _ in $(seq 1 60); do
    if curl -fsS -H "Authorization: $(grep '^LAVALINK_PASSWORD=' .env | cut -d= -f2-)" "http://127.0.0.1:${LAVALINK_PORT:-2333}/v4/info" >/dev/null 2>&1; then
      printf '[%s] lavalink is healthy\n' "$PROJECT_NAME"
      return 0
    fi
    sleep 3
  done
  docker logs --tail=120 nikobox-lavalink || true
  fail "lavalink did not become healthy"
}

print_status() {
  log "Final service status"
  $COMPOSE ps
  cat <<MSG

NikoBox is installed.
Dashboard: http://$(hostname -I | awk '{print $1}'):${WEB_PORT:-3000}
Bot API:   http://$(hostname -I | awk '{print $1}'):${BOT_PORT:-4000}

Useful commands:
  docker compose logs -f
  docker compose restart
  git pull && docker compose up -d --build
MSG
}

main() {
  install_base_dependencies
  install_docker
  prepare_env
  build_and_start
  wait_for_lavalink
  wait_for_health bot 40
  wait_for_health web 40
  print_status
}

main "$@"
