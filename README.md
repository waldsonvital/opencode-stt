# opencode-stt

TUI plugin for **OpenCode V2** (pin `@opencode/plugin` **2.0.3**) that adds
dictation (speech-to-text) to the composer: it records the microphone,
transcribes, and either **inserts** the text into the prompt or **submits**
it directly in the active session.

The default provider is **MiniMax**. It also works with OpenAI Whisper, Groq,
and any **OpenAI-compatible** server (`POST …/audio/transcriptions`).

[Português (Brasil)](README.pt-BR.md)

---

## Credits

This repository is derivative work / a reimplementation by **Waldson Vital**,
based on [cgarrot/opencode-stt](https://github.com/cgarrot/opencode-stt)
(MIT, Copyright 2026 OpenCode STT contributors).

The plugin API comes from `@opencode/plugin` (MIT).

## License

MIT. Both copyrights and the full text are in [`LICENSE`](LICENSE).

---

## Prerequisites

| Tool | Why | Check |
|---|---|---|
| OpenCode TUI 2.0.3 | Host that loads the plugin | — |
| `ffmpeg` | Records the microphone via PulseAudio/PipeWire | `which ffmpeg` |
| `wl-copy`, `wl-paste` (`wl-clipboard`) | Wayland clipboard (insertion into the composer) | `which wl-copy` |
| PulseAudio or PipeWire | Audio source `default` (hardcoded) | `ls /run/user/$UID/pulse/native` |

Without `wl-copy`/`wl-paste`, `/stt-selftest` and any composer insertion
fail. **There is no X11 fallback** (`xclip`/`xsel` are not used).

---

## Installation

```bash
cd /path/to/opencode-stt
./install.sh
```

The script installs dependencies, creates `~/.config/opencode/plugins` if
needed, and points a symlink at this repository root. It is idempotent:
running it again only recreates the link.

Open OpenCode and run **`/stt-config`** to choose the provider and paste the
API key. Then use **`ctrl+alt+v`** to dictate.

The key does **not** need to live in the code. If you prefer, export the
environment variable **before** opening OpenCode — it overrides the file
written by the wizard:

```bash
export MINIMAX_API_KEY="your-key"   # or OPENAI_API_KEY / GROQ_API_KEY
```

---

## `/stt-config`

Dialogs inside OpenCode itself. Canceling at any step **does not write**
anything.

| Preset | Endpoint / model | Key env |
|---|---|---|
| MiniMax (default) | fixed MiniMax endpoint | `MINIMAX_API_KEY` |
| OpenAI Whisper | `https://api.openai.com/v1` · `whisper-1` | `OPENAI_API_KEY` |
| Groq | `https://api.groq.com/openai/v1` · `whisper-large-v3-turbo` | `GROQ_API_KEY` |
| Other (OpenAI-compatible) | you provide `baseUrl` and `model` | env name (default `OPENAI_API_KEY`) |

The key is requested in an **unmasked** dialog (the text is visible on
screen) and goes only to `~/.config/opencode/opencode-stt.secrets.json`
with mode `600`. It does not enter git or plugin storage.

**Key precedence:** non-empty `process.env[envName]` **overrides** the
secrets file. Without either, the plugin asks you to run `/stt-config`.

On the **Other** preset, provide only the base (`…/v1`), **not** the
`/audio/transcriptions` path. openai-compat **ignores** language
(`/stt-language` does not affect Groq/OpenAI/LM Studio).

---

## Commands and keybinds

Keybinds are **not** configurable.

| Keybind | Slash | What it does |
|---|---|---|
| `ctrl+alt+v` | `/stt-record` | Toggle recording. On stop, transcribes and **inserts into the composer**. |
| `<leader>v` | `/stt-submit` | Toggle recording. On stop, transcribes and **submits the prompt**. |
| — | `/stt-stop` | Cancels the current recording without transcribing. |
| — | `/stt-language` | Dialog `pt` / `en` / `es` / `auto`. Persisted. Only MiniMax uses language in the request. |
| — | `/stt-config` | Chooses the provider and saves the API key. |
| — | `/stt-selftest` | Inserts fixed text into the composer (no audio). Validates clipboard + `prompt.paste`. |

The plugin uses the bind `"<leader>v"`; the value of `<leader>` comes from
the host. Commands also appear in the command palette (`palette: true`).

---

## ASR chip

Slot `prompt.footer.status` (append; does not replace the host effort
indicator). Idle renders nothing.

| Phase | Chip |
|---|---|
| Recording | `● ASR` |
| Transcribing | braille spinner + ` ASR` |
| Success | `✓ ASR` (~2.5 s, then it disappears) |

---

## How insertion works

OpenCode V2 does not expose a public “append to composer” API. In insert
mode, the plugin:

1. Saves the current clipboard (`wl-paste --no-newline`).
2. Copies the transcribed text (`wl-copy`).
3. Dispatches the internal `prompt.paste` command.
4. Waits ~180 ms for the TUI to read the clipboard.
5. Restores the original clipboard.

Submit mode uses `session.prompt` on the active session (it does not go
through the clipboard).

Temporary audio: `/tmp/opencode/opencode-stt.wav` (removed after
transcription or cancel). Recording: `ffmpeg -f pulse -i default -ac 1 -ar 16000`,
finished with SIGINT. Cap of 495 s (MiniMax limit 500 s). Transcription
timeout: 180 s.

---

## Limitations

- **Wayland only** (`wl-copy` / `wl-paste`). No X11.
- Pulse source **hardcoded** `default`.
- openai-compat **ignores** language.
- MiniMax model `asr-1.0` and the MiniMax endpoint are **not** configurable.
- Fixed keybinds (`ctrl+alt+v`, `<leader>v`).
- Maximum of 495 s per dictation.
- No automatic retry — a network failure becomes an error toast.
- The API key dialog **does not mask** the text.

---

## Advanced

Host options (`context.options`) still **seed** provider/URL/model, same
as language. After you run `/stt-config`, what the wizard wrote wins. You
do not need to edit `src/tui.ts`.

---

## Troubleshooting

**"Chave de API não encontrada. Rode /stt-config…"** — there is no env
visible to the OpenCode process and no secrets file. Run `/stt-config` or
export the env **before** opening the TUI. Remember: a non-empty env
overrides the file.

**"Configure o provedor com /stt-config (baseUrl e model…)"** — the
provider is openai-compat but URL/model are not set. Run `/stt-config` and
choose OpenAI, Groq, or Other.

**"Não foi possível iniciar a gravação"** — test the `default` source:

```bash
ffmpeg -y -f pulse -i default -ac 1 -ar 16000 /tmp/teste.wav
```

If only another source works (`pactl list sources short`), the plugin
does **not** accept that via option: you must change `"-i", "default"` in
`src/recorder.ts`.

**`wl-copy` falhou** — install `wl-clipboard`. No X11 fallback.

**401 MiniMax** — invalid or expired key.

**413 MiniMax** — audio > 50 MB or > 500 s (the plugin already cuts at 495 s).

**429 MiniMax** — rate limit.

**Success toast but empty composer** — run `/stt-selftest` with an
**open session** (on the home screen `prompt.paste` has no visible effect).
If selftest pastes, the issue was the 180 ms window latency or a
non-text clipboard (image/file): save/restore only handles text.

**Plugin does not appear** — run `./install.sh` again and restart OpenCode.
The symlink `~/.config/opencode/plugins/opencode-stt` must point at the
package root (with `tui.ts`).
