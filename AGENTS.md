# AGENTS.md

Facts an agent will miss. Humans: `./install.sh`, then OpenCode `/stt-config`. Do not treat `src/tui.ts` defaults as the config path.

## Commands

- `npm test` → `node --test test/*.test.mjs`
- `npm run typecheck` → `tsc --noEmit`
- One file: `node --test test/core.test.mjs`
- No bundler, no build. Host and tests load `.ts` as-is (`package.json` exports; `tsconfig` `noEmit` + `allowImportingTsExtensions`).

## Entrypoints

- Plugin load needs **root** `tui.ts` visible: `./install.sh` or symlink repo root → `~/.config/opencode/plugins/opencode-stt` (root `tui.ts` re-exports `src/tui.ts`).
- `src/index.ts` is a no-op server entry required by exports. All STT is TUI.

## Do not break

- Register `keymap.layer` **inside** `ui.slot({ append: "app", render })`, never from `setup()` (OpenCode 2.0.3: setup is outside Keymap.Provider).
- Import `define` from `@opencode/plugin/tui/plugin` (not `/tui`) so Solid is not pulled into `tui.ts`.
- Never `replace` on `prompt.footer.status` — append only or the host effort chip disappears.
- `getProvider` must resolve store + env + secrets **at call time** (core calls it on finalize). Do not capture provider/key at setup.
- Pin `@opencode/plugin` at exact `2.0.3`. Do not bump without re-checking keymap scope.
- JSX only in `.tsx` (`src/status.tsx`); `jsxImportSource` `@opentui/solid`.
- `busy` serializes spawn and stop→transcribe→insert. After a successful start `busy` is false so the next tap finalizes. `cancel()` is a no-op while transcribing (recorder already null). Persist the recorder in the memory store for hot-reload reap.

## Config / secrets

- `/stt-config` writes provider fields to `storage.store`; API keys to `~/.config/opencode/opencode-stt.secrets.json` mode 600 (`{ keys: { ENV: value } }`).
- Store wins provider/url/model (options only seed initial). Non-empty `process.env[apiKeyEnv]` wins over the secrets file.
- Never log or toast the key. `dialog.prompt` for the key is unmasked.
- Default MiniMax. openai-compat requires baseUrl+model. Language hint is MiniMax-only.

## Platform

- ffmpeg: `-f pulse -i default`, WAV `/tmp/opencode/opencode-stt.wav`, stop with **SIGINT** not SIGKILL. Await spawn or ENOENT crashes the TUI host.
- Clipboard: `wl-copy` / `wl-paste` only. No xclip.

## Tests

- Node `node:test`. No TUI/slot/insert tests. Core injects a mocked `getProvider`.
- `ponytail:` comments mark real traps — keep them; add only for new traps.
