#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

npm install
mkdir -p "${HOME}/.config/opencode/plugins"
ln -sfn "$ROOT" "${HOME}/.config/opencode/plugins/opencode-stt"

echo "Plugin installed at ~/.config/opencode/plugins/opencode-stt"
echo "Open OpenCode and run /stt-config to choose the provider and paste the API key."
echo "Then use ctrl+alt+v to dictate."
