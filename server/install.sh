#!/usr/bin/env bash
# Instala o actualiza Pulso como stack de Dockge y lo publica en tu tailnet por HTTPS.
# Uso:  sudo bash server/install.sh        (desde la carpeta del repositorio)
set -euo pipefail

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STACK=/opt/stacks/pulso
PORT=8090

if [[ $EUID -ne 0 ]]; then echo "Ejecuta con sudo: sudo bash $0"; exit 1; fi

echo "→ Copiando código a $STACK/src"
mkdir -p "$STACK/data"
rsync -a --delete --exclude .git --exclude '.build' --exclude 'server/tests' --exclude '*.xcodeproj' "$SRC/" "$STACK/src/"
if [[ ! -f "$STACK/compose.yaml" ]]; then
  cp "$SRC/server/compose.yaml" "$STACK/compose.yaml"
  echo "→ compose.yaml creado (edítalo en Dockge si quieres cambiar algo)"
fi

echo "→ Construyendo y arrancando el contenedor (la primera vez tarda unos minutos: compila el motor Swift)"
cd "$STACK"
docker compose up -d --build

echo "→ Esperando a que responda…"
for i in $(seq 1 60); do
  if curl -fs "http://127.0.0.1:$PORT/api/health" >/dev/null; then ok=1; break; fi
  sleep 2
done
[[ "${ok:-}" == 1 ]] || { echo "El contenedor no responde. Mira los logs: docker logs pulso"; exit 1; }

echo "→ Publicando en Tailscale (HTTPS)"
tailscale serve --bg --https=443 "http://127.0.0.1:$PORT"
tailscale serve status || true

HOST=$(tailscale status --json | python3 -c "import json,sys; print(json.load(sys.stdin)['Self']['DNSName'].rstrip('.'))")
echo
echo "✅ Pulso listo en: https://$HOST"
echo "   Ábrelo en Bluefy en el iPhone (con Tailscale activo) y en el navegador del ordenador."
