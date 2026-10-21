/**
 * Structured JSON logs with an allowlist of fields.
 * Patient data can't reach the logs by accident: anything not named here doesn't compile.
 */
import type { Variant } from './server';

type Fields = Partial<{
  reqId: string;
  method: string;
  path: string;
  status: number;
  ms: number;
  mode: 'live' | 'degraded';
  variant: Variant;
  model: string;
  modelMs: number;
  inputTokens: number;
  escalations: number;
  fields: number;
  asked: number;
  error: string;
  /** Skipped questions shown back with the patient's own words. A count, never the words. */
  said: number;
  extractMs: number;
  extractError: string;
  extractor: string;
  port: number;
  state: 'closed' | 'open' | 'half-open';
}>;

type Level = 'info' | 'warn' | 'error';

export function log(level: Level, msg: string, fields: Fields = {}): void {
  const line = JSON.stringify({ ts: new Date().toISOString(), level, msg, ...fields });
  if (level === 'info') console.log(line);
  else console.error(line);
}
