// Plugin loader entry when the package is consumed via the plugin symlink
// (`~/.config/opencode/plugins/<name>` pointing at the repo root); re-exports the TUI-side plugin so the loader can resolve it.
export { default } from "./src/tui.ts";