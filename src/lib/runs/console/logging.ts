/** Max length for general string context values (URLs use a shorter cap). */
const MAX_STRING_LEN = 96;
const MAX_URL_LEN = 72;
/** Nesting cap so nested objects never expand into huge JSON blobs. */
const MAX_CONTEXT_DEPTH = 4;

function truncateText(text: string, max: number): string {
  if (text.length <= max) return text;
  if (max <= 1) return "…";
  return `${text.slice(0, max - 1)}…`;
}

function isHttpUrl(s: string): boolean {
  return /^https?:\/\//i.test(s);
}

function formatContextValue(value: unknown, depth = 0): string {
  if (depth > MAX_CONTEXT_DEPTH) return "…";

  if (value === null) return "null";
  if (value === undefined) return "undefined";

  if (typeof value === "string") {
    const max = isHttpUrl(value) ? MAX_URL_LEN : MAX_STRING_LEN;
    return truncateText(value, max);
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  if (value instanceof Error) {
    return truncateText(value.message, MAX_STRING_LEN);
  }

  if (Array.isArray(value)) {
    const preview = value
      .slice(0, 3)
      .map((item) => formatContextValue(item, depth + 1));
    const suffix = value.length > 3 ? ` +${value.length - 3}` : "";
    return `[${preview.join(",")}${suffix}]`;
  }

  if (typeof value === "object" && value !== null) {
    const o = value as Record<string, unknown>;
    if (typeof o.message === "string") {
      const msg = truncateText(o.message, MAX_STRING_LEN);
      const code = o.code;
      if (typeof code === "string" && code.length > 0 && code.length <= 32) {
        return `${code}: ${msg}`;
      }
      return msg;
    }

    const entries = Object.entries(o);
    if (entries.length === 0) return "{}";
    return entries
      .map(([k, v]) => `${k}=${formatContextValue(v, depth + 1)}`)
      .join(" ");
  }

  try {
    return truncateText(JSON.stringify(value), MAX_STRING_LEN);
  } catch {
    return truncateText(String(value), MAX_STRING_LEN);
  }
}

function formatContext(context: Record<string, unknown>): string {
  const entries = Object.entries(context);
  if (entries.length === 0) return "";
  return entries
    .map(([key, value]) => `${key}=${formatContextValue(value)}`)
    .join(" | ");
}

export function logLine(message: string, context?: Record<string, unknown>) {
  const ts = new Date().toISOString().slice(11, 19);
  const contextText = context ? formatContext(context) : "";
  if (context) {
    console.log(
      `[console:workflow] ${ts} ${message}${contextText ? ` | ${contextText}` : ""}`,
    );
  } else {
    console.log(`[console:workflow] ${ts} ${message}`);
  }
}

export function divider(label: string) {
  logLine(`[stage] ${label}`);
}
