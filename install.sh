#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

npm install
mkdir -p "${HOME}/.config/opencode/plugins"
ln -sfn "$ROOT" "${HOME}/.config/opencode/plugins/opencode-stt"

echo "Plugin instalado em ~/.config/opencode/plugins/opencode-stt"
echo "Abra o OpenCode e rode /stt-config para escolher o provedor e colar a API key."
echo "Depois use ctrl+alt+v para ditar."
