export function getGeminiApiKey(): string {
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    throw new Error("Missing GEMINI_API_KEY");
  }
  return key;
}

export function getGeminiModel(): string {
  return process.env.GEMINI_MODEL ?? "gemini-3-flash-preview";
}
