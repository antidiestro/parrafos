import { createGeminiClient } from "./client";
import { getGeminiModel } from "./env";

export async function generateGeminiText(
  prompt: string,
  opts?: { model?: string },
): Promise<string> {
  const ai = createGeminiClient();
  const model = opts?.model ?? getGeminiModel();

  const response = await ai.models.generateContent({
    model,
    contents: prompt,
  });

  // SDK shape can change; handle both `response.text` and `response.text()` safely.
  const rawText = (response as { text?: unknown }).text;
  type TextGetter = (this: unknown) => unknown;
  const text =
    typeof rawText === "function"
      ? (rawText as TextGetter).call(response)
      : rawText;

  const trimmed = String(text ?? "").trim();
  if (!trimmed) {
    throw new Error("Gemini returned empty response text");
  }
  return trimmed;
}
