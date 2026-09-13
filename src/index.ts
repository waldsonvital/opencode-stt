/**
 * Server-side plugin entry (no-op for this STT plugin).
 * Required by the package `exports` map so OpenCode can resolve the plugin root.
 */
import { Plugin } from "@opencode/plugin";

export default Plugin.define({
  id: "opencode-stt",
  async setup() {
    // No server-side work — STT runs entirely in the TUI host.
  },
});