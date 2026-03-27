const DEFAULT_TIMEOUT_MS = 15_000;
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36";

export type FetchHtmlResult = {
  finalUrl: string;
  html: string;
  status: number;
};

export async function fetchHtmlWithRetries(
  url: string,
  opts?: { retries?: number; timeoutMs?: number },
): Promise<FetchHtmlResult> {
  const retries = opts?.retries ?? 2;
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      console.log(
        `[worker:runs] ${new Date().toISOString()} fetchHtmlWithRetries: attempt`,
        {
          url,
          attempt: attempt + 1,
          maxAttempts: retries + 1,
          timeoutMs: opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        },
      );
      const result = await fetchHtml(url, {
        timeoutMs: opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      });

      console.log(
        `[worker:runs] ${new Date().toISOString()} fetchHtmlWithRetries: success`,
        {
          url,
          finalUrl: result.finalUrl,
          status: result.status,
          htmlChars: result.html.length,
        },
      );

      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      lastError = error instanceof Error ? error : new Error("Fetch failed");
      console.log(
        `[worker:runs] ${new Date().toISOString()} fetchHtmlWithRetries: attempt failed`,
        {
          url,
          attempt: attempt + 1,
          error: message,
        },
      );
      if (attempt < retries) {
        await new Promise((resolve) =>
          setTimeout(resolve, (attempt + 1) * 500),
        );
      }
    }
  }

  throw lastError ?? new Error("Unable to fetch URL");
}

async function fetchHtml(
  url: string,
  opts: { timeoutMs: number },
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

  return {
    finalUrl: res.url || url,
    html: text,
    status: res.status,
  };
}
