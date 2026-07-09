// Log hygiene: untrusted text (external-service error bodies, DB error
// messages, LLM-extracted issue labels) can carry newlines and control
// characters that forge fake log lines in an aggregator. Sanitize any
// such value before interpolating it into a log message.

const MAX_LOG_FIELD = 300;

// C0 (\x00-\x1F) and C1 (\x7F-\x9F) control characters, written as hex
// escapes so no invisible bytes live in this source file.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\x00-\x1F\x7F-\x9F]/g;

/**
 * Collapse CR/LF to a space, strip other control characters, then bound
 * the length. Use on ANY externally-influenced string before logging it.
 */
export function sanitizeForLog(value: unknown): string {
  const raw = value instanceof Error ? value.message : String(value ?? "");
  const cleaned = raw.replace(/[\r\n]+/g, " ").replace(CONTROL_CHARS, "");
  return cleaned.length > MAX_LOG_FIELD ? `${cleaned.slice(0, MAX_LOG_FIELD)}…` : cleaned;
}
