# opencode-stt

Plugin CLI para **OpenCode V2** que adiciona ditado (speech-to-text) direto no
composer. Provider-agnostic: suporta **MiniMax** e qualquer servidor
**OpenAI-compatible** (Groq, OpenAI Whisper, LM Studio etc.).

A transcrição é inserida no campo de prompt via clipboard + o comando interno
`prompt.paste`, ou enviada como prompt direto na sessão ativa.

---

## Pré-requisitos do sistema

| Ferramenta | Por quê | Verificar |
|---|---|---|
| `ffmpeg` | Gravar microfone via PulseAudio/PipeWire | `which ffmpeg` |
| `wl-copy`, `wl-paste` | Manipular o clipboard do Wayland | `which wl-copy` |
| `PulseAudio` ou `PipeWire` | Source de áudio padrão | `ls /run/user/$UID/pulse/native` |

Sem `wl-copy`/`wl-paste`, `/stt-selftest` e qualquer inserção no composer
falham com mensagem de erro clara.

---

## Instalação

O OpenCode 2.0.3 descobre plugins em `~/.config/opencode/plugins/<name>`
quando cada entrada é um **symlink** (ou pasta) que resolve para a raiz do
pacote. A raiz precisa expor `tui.ts` reexportando a entrada do plugin.

```bash
cd ~/Projetos/opencode-stt
npm install

mkdir -p ~/.config/opencode/plugins
ln -s ~/Projetos/opencode-stt ~/.config/opencode/plugins/opencode-stt
```

Reinicie o OpenCode. O loader resolve o symlink, carrega `./tui.ts` e roda
o `setup()`.

### Defaults

Sem nenhuma option, o plugin usa:

| Campo | Default | Trocar em |
|---|---|---|
| `provider` | `minimax` | Variável de ambiente (veja abaixo) ou editar `src/tui.ts` |
| `apiKeyEnv` (minimax) | `MINIMAX_API_KEY` | Editar `src/tui.ts` |
| `language` | `pt` | `/stt-language` em runtime (persistido) |

> **Limitação 2.0.3:** entradas `{ "plugins": [{ "package": ..., "options":
> {...} }] }` em `~/.config/opencode/cli.json` — as options do formato
> objeto **não chegam à TUI no 2.0.3** (quebra observada empiricamente
> na entrega da config à TUI; o loader em si suporta o formato). Por
> isso, defaults ficam no código (`src/tui.ts`) e o idioma é ajustável
> em runtime via `/stt-language`. Para trocar provider/keybinds
> persistentes, edite `src/tui.ts` e reinicie a TUI (hot reload revalida
> `setup`).

### Provider MiniMax

Exporte a chave de API antes de abrir o OpenCode:

```bash
export MINIMAX_API_KEY="sua-chave-aqui"
```

Endpoint: `https://api.minimax.io/v1/speech_to_text` (fixo).
Modelo padrão: `asr-1.0` (sobrescrevível editando `createMiniMax` em
`src/providers/minimax.ts`).

### Provider OpenAI-compatible

Para Groq, OpenAI, LM Studio ou qualquer servidor que implemente
`POST {baseUrl}/audio/transcriptions`:

1. Edite `src/tui.ts` e troque o `providerId` para `"openai-compat"`.
2. Preencha `opts.openai.baseUrl`, `opts.openai.model`, e (opcional) o nome
   da env var em `opts.openai.apiKeyEnv` (default `OPENAI_API_KEY`).
3. Exporte `OPENAI_API_KEY` (ou o nome configurado) e reinicie a TUI.

---

## Comandos

| Keybind | Slash | O que faz |
|---|---|---|
| `ctrl+alt+v` | `/stt-record` | Inicia ou para a gravação. Ao parar, transcreve e **insere no composer**. |
| `<leader>v` | `/stt-submit` | Inicia ou para a gravação. Ao parar, transcreve e **envia o prompt**. |
| — | `/stt-stop` | Cancela a gravação atual sem transcrever. |
| — | `/stt-language` | Dialog para escolher `pt` / `en` / `es` / `auto`. Persistido. |
| — | `/stt-selftest` | Insere texto fixo no composer (sem gravar áudio). Útil para validar a inserção. |

`<leader>` é `ctrl+x` por padrão no OpenCode V2.

---

## Como funciona a inserção

A OpenCode V2 não expõe uma API pública de "append no composer". O plugin:

1. Salva o conteúdo atual do clipboard (`wl-paste`).
2. Copia o texto transcrito (`wl-copy`).
3. Despacha o comando interno `prompt.paste` (a cola do prompt).
4. Aguarda ~180 ms para a TUI ler o clipboard.
5. Restaura o clipboard original.

O áudio nunca sai do provider configurado. Arquivo temporário em
`/tmp/opencode/opencode-stt.wav` é removido após transcrição/cancelamento.

A gravação usa `ffmpeg -f pulse -i default -ac 1 -ar 16000` com SIGINT para
finalização limpa. Trava de segurança em 495 s (limite da API MiniMax é 500 s).

---

## Troubleshooting

**"Defina MINIMAX_API_KEY"** — a variável de ambiente não está visível para o
processo do OpenCode. Exporte no shell **antes** de abrir o TUI, ou use um
gerenciador de env (systemd `--Environment`, direnv, etc.).

**"Não foi possível iniciar a gravação"** — cheque se `ffmpeg` consegue abrir
a source `default` do PulseAudio/PipeWire:

```bash
ffmpeg -y -f pulse -i default -ac 1 -ar 16000 /tmp/teste.wav
# Ctrl+C após alguns segundos
```

Se falhar, selecione outra source:

```bash
pactl list sources short
ffmpeg -y -f pulse -i <NOME_DA_SOURCE> ...
```

**`wl-copy` falhou** — instale `wl-clipboard` (Arch) ou equivalente. O plugin
não tem fallback X11.

**401 da MiniMax** — chave inválida ou expirada. Gere outra em
platform.minimax.io.

**413 da MiniMax** — áudio > 50 MB ou > 500 s. O plugin já trava em 495 s.

**429 da MiniMax** — rate limit. Aguarde ou reduza o volume de uso.

**Áudio transcrito mas nada aparece no composer** — rode `/stt-selftest`. Se
nem isso inserir texto, o problema é o mecanismo de clipboard, não o STT.

**Toast de sucesso mas nada colou** — dois casos conhecidos do design
clipboard-only:

1. **Clipboard anterior era não-textual (imagem, arquivo).** `wl-paste
   --no-newline` devolve string vazia ao salvar, e `wl-copy ""` sobrescreve
   o clipboard com vazio na restauração. Resultado: o conteúdo original
   (imagem) é perdido. Para o STT em si funciona, mas é uma limitação
   inerente do mecanismo de save/restore do clipboard.
2. **Janela de 180 ms estourou sob carga alta.** O TUI pode não ter
   consumido o clipboard antes da restauração. Sintoma: o toast de
   sucesso aparece mas o composer fica vazio. Reexecute via
   `/stt-selftest` (não passa por transcrição); se colar, o problema é a
   latência momentânea da TUI — tente de novo.

`/stt-selftest` exige uma sessão aberta: em outras telas (ex.: home) o
dispatch de `prompt.paste` não tem efeito visível porque não há composer.

---

## Limites deliberados

- Máximo de 495 s por ditado (limite da API MiniMax).
- Apenas `response_format=json` (campo `text`).
- Sem retry automático — falhas de rede caem no toast de erro.
- Idioma `"auto"` não envia o header `language` (a MiniMax detecta sozinha).
- **OpenCode 2.0.3:** `setup()` roda fora do `<Keymap.Provider>` Solid; chamar
  `context.keymap.layer(...)` no setup lança `Keymap.Provider is missing`.
  O plugin registra o layer dentro do `render` de um `context.ui.slot({append:"app"})`
  (padrão dos plugins built-in), onde a render roda dentro do Provider.