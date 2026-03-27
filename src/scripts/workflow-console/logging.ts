function formatContextValue(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) {
    const preview = value.slice(0, 3).map((item) => formatContextValue(item));
    const suffix = value.length > 3 ? ` ... +${value.length - 3} more` : "";
    return `[${preview.join(", ")}${suffix}]`;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
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
  const ts = new Date().toISOString();
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
  const title = label.replace(/_/g, " ");
  const bar = "-".repeat(14);
  logLine(`${bar} Starting stage: ${title} ${bar}`);
}
