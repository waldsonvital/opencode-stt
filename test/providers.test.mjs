import test from "node:test";
import assert from "node:assert/strict";
import { writeFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createMiniMax } from "../src/providers/minimax.ts";
import { createOpenAICompat } from "../src/providers/openai-compat.ts";
import { SttError } from "../src/providers/types.ts";

// ---- minimal wav fixture (1 sample of silence at 16kHz mono PCM16) ----
async function makeWav() {
  const dir = await mkdtemp(join(tmpdir(), "stt-test-"));
  const path = join(dir, "fixture.wav");
  // RIFF/WAVE header (44 bytes) + 1 sample of silence
  const header = Buffer.from([
    0x52, 0x49, 0x46, 0x46, // "RIFF"
    0x24, 0x00, 0x00, 0x00, // chunk size (36 + data)
    0x57, 0x41, 0x56, 0x45, // "WAVE"
    0x66, 0x6d, 0x74, 0x20, // "fmt "
    0x10, 0x00, 0x00, 0x00, // subchunk1 size (16)
    0x01, 0x00,             // audio format (PCM)
    0x01, 0x00,             // num channels (1)
    0x80, 0x3e, 0x00, 0x00, // sample rate (16000)
    0x00, 0x7d, 0x00, 0x00, // byte rate (32000)
    0x02, 0x00,             // block align
    0x10, 0x00,             // bits per sample (16)
    0x64, 0x61, 0x74, 0x61, // "data"
    0x02, 0x00, 0x00, 0x00, // subchunk2 size (2 bytes of PCM)
    0x00, 0x00,             // one sample of silence
  ]);
  await writeFile(path, header);
  return { path, dir };
}

function mockFetch(responder) {
  globalThis.fetch = async (url, init) => responder(url, init);
}

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

test("minimax: success returns trimmed text and duration", async () => {
  const { path, dir } = await makeWav();
  try {
    let capturedUrl;
    let capturedInit;
    mockFetch(async (url, init) => {
      capturedUrl = url;
      capturedInit = init;
      return jsonResponse(200, { text: "  olá mundo  ", duration: 1.23, trace_id: "abc" });
    });

    const provider = createMiniMax({ apiKey: "secret-key" });
    const res = await provider.transcribe(path, { language: "pt" });

    assert.equal(res.text, "olá mundo");
    assert.equal(res.duration, 1.23);
    assert.equal(capturedUrl, "https://api.minimax.io/v1/speech_to_text");
    assert.equal(capturedInit.method, "POST");
    assert.match(capturedInit.headers.Authorization, /^Bearer secret-key$/);
    assert.equal(capturedInit.headers.language, "pt");
    assert.ok(capturedInit.body instanceof FormData, "body must be multipart FormData");
    const form = capturedInit.body;
    assert.equal(form.get("model"), "asr-1.0");
    assert.equal(form.get("response_format"), "json");
    assert.ok(form.get("file") instanceof Blob);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("minimax: 401 surfaces server error message", async () => {
  const { path, dir } = await makeWav();
  try {
    mockFetch(async () =>
      jsonResponse(401, {
        type: "error",
        error: { type: "authorized_error", message: "invalid api key", http_code: 401 },
      }),
    );
    const provider = createMiniMax({ apiKey: "bad" });
    await assert.rejects(provider.transcribe(path, { language: "pt" }), (err) => {
      assert.ok(err instanceof SttError);
      assert.equal(err.code, "http_401");
      assert.match(err.message, /invalid api key/);
      return true;
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("minimax: 413 surfaces server error message", async () => {
  const { path, dir } = await makeWav();
  try {
    mockFetch(async () =>
      jsonResponse(413, {
        type: "error",
        error: { type: "file_too_large", message: "audio exceeds 50MB", http_code: 413 },
      }),
    );
    const provider = createMiniMax({ apiKey: "k" });
    await assert.rejects(provider.transcribe(path, {}), (err) => {
      assert.equal(err.code, "http_413");
      assert.match(err.message, /50MB/);
      return true;
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("minimax: 429 surfaces server error message", async () => {
  const { path, dir } = await makeWav();
  try {
    mockFetch(async () =>
      jsonResponse(429, {
        type: "error",
        error: { type: "rate_limited", message: "too many requests", http_code: 429 },
      }),
    );
    const provider = createMiniMax({ apiKey: "k" });
    await assert.rejects(provider.transcribe(path, { language: "en" }), (err) => {
      assert.equal(err.code, "http_429");
      assert.match(err.message, /too many requests/);
      return true;
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("minimax: missing text field returns empty string without throwing", async () => {
  const { path, dir } = await makeWav();
  try {
    mockFetch(async () => jsonResponse(200, { trace_id: "x" }));
    const provider = createMiniMax({ apiKey: "k" });
    const res = await provider.transcribe(path, {});
    assert.equal(res.text, "");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("openai-compat: success sends Authorization + multipart and parses text", async () => {
  const { path, dir } = await makeWav();
  try {
    let capturedUrl;
    let capturedInit;
    mockFetch(async (url, init) => {
      capturedUrl = url;
      capturedInit = init;
      return jsonResponse(200, { text: "hello world" });
    });

    const provider = createOpenAICompat({
      baseUrl: "http://localhost:8000/v1/",
      apiKey: "sk-test",
      model: "whisper-large-v3-turbo",
    });
    const res = await provider.transcribe(path, {});

    assert.equal(res.text, "hello world");
    assert.equal(capturedUrl, "http://localhost:8000/v1/audio/transcriptions");
    assert.match(capturedInit.headers.Authorization, /^Bearer sk-test$/);
    const form = capturedInit.body;
    assert.equal(form.get("model"), "whisper-large-v3-turbo");
    assert.ok(form.get("file") instanceof Blob);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("openai-compat: non-2xx surfaces HTTP status", async () => {
  const { path, dir } = await makeWav();
  try {
    mockFetch(async () => new Response("upstream down", { status: 502 }));
    const provider = createOpenAICompat({ baseUrl: "https://x.example/v1", apiKey: "k", model: "m" });
    await assert.rejects(provider.transcribe(path, {}), (err) => {
      assert.equal(err.code, "http_502");
      assert.match(err.message, /upstream down/);
      return true;
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});