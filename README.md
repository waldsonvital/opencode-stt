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

```bash
cd ~/Projetos/opencode-stt
npm install
```

Adicione ao seu `~/.config/opencode/cli.json`:

```jsonc
{
  "plugins": [
    {
      "package": "/home/waldson/Projetos/opencode-stt",
      "options": {
        "provider": "minimax",
        "apiKeyEnv": "MINIMAX_API_KEY",
        "language": "pt"
      }
    }
  ]
}
```

Reinicie o OpenCode.

### Provider MiniMax

Exporte a chave de API antes de abrir o OpenCode:

```bash
export MINIMAX_API_KEY="sua-chave-aqui"
```

Endpoint: `https://api.minimax.io/v1/speech_to_text` (fixo).
Modelo padrão: `asr-1.0` (sobrescrevível via `options.minimax.model`).

### Provider OpenAI-compatible

Para Groq, OpenAI, LM Studio ou qualquer servidor que implemente
`POST {baseUrl}/audio/transcriptions`:

```jsonc
{
  "plugins": [
    {
      "package": "/home/waldson/Projetos/opencode-stt",
      "options": {
        "provider": "openai-compat",
        "language": "pt",
        "openai": {
          "baseUrl": "http://localhost:8000/v1",
          "model": "whisper-large-v3-turbo",
          "apiKeyEnv": "OPENAI_API_KEY"
        }
      }
    }
  ]
}
```

E exporte `OPENAI_API_KEY` (ou o nome configurado em `apiKeyEnv`).

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

---

## Limites deliberados

- Máximo de 495 s por ditado (limite da API MiniMax).
- Apenas `response_format=json` (campo `text`).
- Sem retry automático — falhas de rede caem no toast de erro.
- Idioma `"auto"` não envia o header `language` (a MiniMax detecta sozinha).