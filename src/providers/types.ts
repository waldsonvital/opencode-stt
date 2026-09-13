export class SttError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "SttError";
    this.code = code;
  }
}

export interface SttResult {
  readonly text: string;
  readonly duration?: number;
}

export interface SttOptions {
  readonly language?: string;
}

export interface SttProvider {
  readonly id: string;
  transcribe(wavPath: string, opts: SttOptions): Promise<SttResult>;
}