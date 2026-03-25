const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_BYTES = 1_500_000;
const USER_AGENT = "parrafos-runner/1.0 (+https://parrafos.local)";

export type FetchHtmlResult = {
  finalUrl: string;
  html: string;
  status: number;
};

export async function fetchHtmlWithRetries(
  url: string,
  opts?: { retries?: number; timeoutMs?: number; maxBytes?: number },
): Promise<FetchHtmlResult> {
  const retries = opts?.retries ?? 2;
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await fetchHtml(url, {
        timeoutMs: opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        maxBytes: opts?.maxBytes ?? DEFAULT_MAX_BYTES,
      });
    } catch (error) {
      lastError = error instanceof Error ? error : new Error("Fetch failed");
      if (attempt < retries) {
        await new Promise((resolve) => setTimeout(resolve, (attempt + 1) * 500));
      }
    }
  }

  throw lastError ?? new Error("Unable to fetch URL");
}

async function fetchHtml(
  url: string,
  opts: { timeoutMs: number; maxBytes: number },
): Promise<FetchHtmlResult> {
  const res = await fetch(url, {
    method: "GET",
    redirect: "follow",
    signal: AbortSignal.timeout(opts.timeoutMs),
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "text/html,application/xhtml+xml",
    },
  });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status} for ${url}`);
  }

  const contentType = res.headers.get("content-type") ?? "";
  if (!/html|xml/i.test(contentType)) {
    throw new Error(`Unsupported content-type for ${url}: ${contentType}`);
  }

  const text = await res.text();
  if (text.length > opts.maxBytes) {
    throw new Error(`Response too large for ${url}`);
  }

  return {
    finalUrl: res.url || url,
    html: text,
    status: res.status,
  };
}
