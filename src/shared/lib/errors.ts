import { t } from "../i18n";

/// Backend failures in words a person can act on (WRITE-01; plan ruling 5).
/// The backend rejects with English prose today (backend B13 asks for codes).
/// A message this table knows becomes one translated sentence and its raw
/// text, which often holds an id or a path, is dropped; anything else is shown
/// as the backend wrote it, as the muted detail under a translated title.
const KNOWN: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bmigration is already running\b/i, "errors.migrationRunning"],
  [/\bis already running\b/i, "errors.alreadyRunning"],
  [/\bnot installed yet\b/i, "errors.engineMissing"],
  [/\bauth failed\b|\bno acceptable auth method\b/i, "errors.proxyAuth"],
  [/\btimed out\b|\bos error (?:60|10060)\b/i, "errors.timedOut"],
  [/error sending request|dns error|connection refused|network is unreachable|\bos error (?:51|61|65|10051|10061|10065)\b/i, "errors.offline"],
  [/every geo source failed/i, "errors.geoFailed"],
  [/expected value at line|EOF while parsing|invalid type: |key must be a string|trailing characters at line/i, "errors.badJson"],
  [/no such file or directory|\bos error 2\b|cannot find the (?:file|path) specified/i, "errors.notFound"],
];

/** Backend error codes (B13) to keys, for when commands reject with `{ code }`. */
const CODES: Readonly<Record<string, string>> = {
  already_running: "errors.alreadyRunning",
  engine_missing: "errors.engineMissing",
  proxy_missing: "errors.proxyMissing",
  proxy_unreachable: "errors.proxyUnreachable",
  bad_clipboard_json: "errors.badJson",
  offline: "errors.offline",
  trash_failed: "errors.trashFailed",
};

/** The backend's own words, or undefined when there are none to show. */
export function rawError(e: unknown): string | undefined {
  if (e === undefined || e === null) return undefined;
  if (e instanceof Error) return e.message.trim() || undefined;
  if (typeof e === "string") return e.replace(/^Error:\s*/, "").trim() || undefined;
  if (typeof e === "object") {
    const m = (e as { message?: unknown }).message;
    return typeof m === "string" && m.trim() ? m.trim() : undefined;
  }
  return String(e);
}

/** The line under an error toast's title: a translated sentence for a known
 *  failure, else the backend's words; undefined when there is nothing to say. */
export function explainError(e: unknown): string | undefined {
  if (e && typeof e === "object" && !(e instanceof Error)) {
    const code = (e as { code?: unknown }).code;
    if (typeof code === "string" && CODES[code]) return t(CODES[code]);
  }
  const raw = rawError(e);
  if (!raw) return undefined;
  for (const [re, key] of KNOWN) if (re.test(raw)) return t(key);
  return raw;
}
