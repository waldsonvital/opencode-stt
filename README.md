# opencode-stt

Plugin TUI para **OpenCode V2** (pin `@opencode/plugin` **2.0.3**) que adiciona
ditado (speech-to-text) no composer: grava o microfone, transcreve e **insere**
o texto no prompt ou **envia** direto na sessão ativa.

O provider padrão é **MiniMax**. Também funciona com OpenAI Whisper, Groq e
qualquer servidor **OpenAI-compatible** (`POST …/audio/transcriptions`).

---

## Créditos

Este repositório é trabalho derivado / reimplementação de **Waldson Vital**,
baseado em [cgarrot/opencode-stt](https://github.com/cgarrot/opencode-stt)
(MIT, Copyright 2026 OpenCode STT contributors).

A API de plugin vem de `@opencode/plugin` (MIT).

## Licença

MIT. Os dois copyrights e o texto completo estão em [`LICENSE`](LICENSE).

---

## Pré-requisitos

| Ferramenta | Por quê | Verificar |
|---|---|---|
| OpenCode TUI 2.0.3 | Host que carrega o plugin | — |
| `ffmpeg` | Grava o microfone via PulseAudio/PipeWire | `which ffmpeg` |
| `wl-copy`, `wl-paste` (`wl-clipboard`) | Clipboard Wayland (inserção no composer) | `which wl-copy` |
| PulseAudio ou PipeWire | Source de áudio `default` (hardcoded) | `ls /run/user/$UID/pulse/native` |

Sem `wl-copy`/`wl-paste`, `/stt-selftest` e qualquer inserção no composer
falham. **Não há fallback X11** (`xclip`/`xsel` não são usados).

---

## Instalação

```bash
cd /caminho/para/opencode-stt
./install.sh
```

O script instala as dependências, cria `~/.config/opencode/plugins` se
preciso e aponta um symlink para a raiz deste repositório. É idempotente:
rodar de novo só recria o link.

Abra o OpenCode e rode **`/stt-config`** para escolher o provedor e colar a
API key. Depois use **`ctrl+alt+v`** para ditar.

A key **não** precisa estar no código. Você pode, se preferir, exportar a
variável de ambiente **antes** de abrir o OpenCode — ela vence o arquivo
gravado pelo wizard:

```bash
export MINIMAX_API_KEY="sua-chave"   # ou OPENAI_API_KEY / GROQ_API_KEY
```

---

## `/stt-config`

Dialogs no próprio OpenCode. Cancelar em qualquer passo **não grava** nada.

| Preset | Endpoint / modelo | Env da key |
|---|---|---|
| MiniMax (padrão) | endpoint MiniMax fixo | `MINIMAX_API_KEY` |
| OpenAI Whisper | `https://api.openai.com/v1` · `whisper-1` | `OPENAI_API_KEY` |
| Groq | `https://api.groq.com/openai/v1` · `whisper-large-v3-turbo` | `GROQ_API_KEY` |
| Outro (OpenAI-compatible) | você informa `baseUrl` e `model` | nome da env (default `OPENAI_API_KEY`) |

A key é pedida num dialog **sem máscara** (o texto aparece na tela) e vai
só para `~/.config/opencode/opencode-stt.secrets.json` com permissão `600`.
Não entra no git nem no storage do plugin.

**Precedência da key:** `process.env[nomeDaEnv]` se não-vazio **vence** o
arquivo de secrets. Sem os dois, o plugin pede para rodar `/stt-config`.

No preset **Outro**, informe só a base (`…/v1`), **não** o path
`/audio/transcriptions`. openai-compat **ignora** o idioma
(`/stt-language` não afeta Groq/OpenAI/LM Studio).

---

## Comandos e atalhos

Keybinds **não** são configuráveis.

| Keybind | Slash | O que faz |
|---|---|---|
| `ctrl+alt+v` | `/stt-record` | Alterna gravação. Ao parar, transcreve e **insere no composer**. |
| `<leader>v` | `/stt-submit` | Alterna gravação. Ao parar, transcreve e **envia o prompt**. |
| — | `/stt-stop` | Cancela a gravação atual sem transcrever. |
| — | `/stt-language` | Dialog `pt` / `en` / `es` / `auto`. Persistido. Só o MiniMax usa o idioma no request. |
| — | `/stt-config` | Escolhe provedor e grava a API key. |
| — | `/stt-selftest` | Insere texto fixo no composer (sem áudio). Valida clipboard + `prompt.paste`. |

O plugin usa o bind `"<leader>v"`; o valor de `<leader>` vem do host.
Os comandos também aparecem na command palette (`palette: true`).

---

## Chip ASR

Slot `prompt.footer.status` (append; não substitui o indicador de esforço
do host). Idle não renderiza nada.

| Fase | Chip |
|---|---|
| Gravando | `● ASR` |
| Transcrevendo | spinner braille + ` ASR` |
| Sucesso | `✓ ASR` (~2,5 s, depois some) |

---

## Como funciona a inserção

A OpenCode V2 não expõe API pública de “append no composer”. No modo inserir,
o plugin:

1. Salva o clipboard atual (`wl-paste --no-newline`).
2. Copia o texto transcrito (`wl-copy`).
3. Despacha o comando interno `prompt.paste`.
4. Espera ~180 ms para a TUI ler o clipboard.
5. Restaura o clipboard original.

O modo enviar usa `session.prompt` na sessão ativa (não passa pelo clipboard).

Áudio temporário: `/tmp/opencode/opencode-stt.wav` (removido após transcrição
ou cancelamento). Gravação: `ffmpeg -f pulse -i default -ac 1 -ar 16000`,
finalizada com SIGINT. Teto de 495 s (limite MiniMax 500 s). Timeout de
transcrição: 180 s.

---

## Limitações

- **Só Wayland** (`wl-copy` / `wl-paste`). Sem X11.
- Source Pulse **hardcoded** `default`.
- openai-compat **ignora** o idioma.
- Modelo MiniMax `asr-1.0` e o endpoint MiniMax **não** são configuráveis.
- Keybinds fixos (`ctrl+alt+v`, `<leader>v`).
- Máximo de 495 s por ditado.
- Sem retry automático — falha de rede vira toast de erro.
- O dialog da API key **não mascara** o texto.

---

## Avançado

Options do host (`context.options`) ainda **semeiam** provedor/URL/modelo,
como o idioma. Depois que você roda `/stt-config`, o que o wizard gravou
vence. Não é preciso editar `src/tui.ts`.

---

## Troubleshooting

**"Chave de API não encontrada. Rode /stt-config…"** — não há env visível
para o processo do OpenCode nem arquivo de secrets. Rode `/stt-config` ou
exporte a env **antes** de abrir o TUI. Lembre: env não-vazia vence o
arquivo.

**"Configure o provedor com /stt-config (baseUrl e model…)"** — o provedor
é openai-compat mas URL/modelo não estão definidos. Rode `/stt-config` e
escolha OpenAI, Groq ou Outro.

**"Não foi possível iniciar a gravação"** — teste a source `default`:

```bash
ffmpeg -y -f pulse -i default -ac 1 -ar 16000 /tmp/teste.wav
```

Se só outra source funcionar (`pactl list sources short`), o plugin **não**
aceita isso por option: é preciso alterar `"-i", "default"` em
`src/recorder.ts`.

**`wl-copy` falhou** — instale `wl-clipboard`. Sem fallback X11.

**401 MiniMax** — chave inválida ou expirada.

**413 MiniMax** — áudio > 50 MB ou > 500 s (o plugin já corta em 495 s).

**429 MiniMax** — rate limit.

**Toast de sucesso mas o composer vazio** — rode `/stt-selftest` com uma
**sessão aberta** (na home o `prompt.paste` não tem efeito visível). Se o
selftest colar, o problema foi latência da janela de 180 ms ou clipboard
não-textual (imagem/arquivo): o save/restore só trata texto.

**Plugin não aparece** — rode `./install.sh` de novo e reinicie o OpenCode.
O symlink `~/.config/opencode/plugins/opencode-stt` precisa apontar para a
raiz do pacote (com `tui.ts`).
