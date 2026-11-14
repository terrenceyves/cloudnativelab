#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
if [ ! -f .env ]; then
  umask 077
  password=$(openssl rand -hex 24)
  printf 'POSTGRES_PASSWORD=%s\nAPP_PORT=3100\n' "$password" > .env
  echo 'Configuration locale créée dans .env.'
else
  echo 'Configuration .env existante conservée.'
fi
