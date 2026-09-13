// Plugin loader entry when the package is consumed via the plugin symlink
// (`~/.config/opencode/plugins/<name>` pointing at the repo root). Re-exports
// the TUI-side plugin so the loader can resolve and instantiate it.
export { default } from "./src/tui.ts";