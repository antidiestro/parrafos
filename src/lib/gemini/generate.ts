import { createGeminiClient } from "./client";
import { getGeminiModel } from "./env";
import type { z } from "zod";

export async function generateGeminiText(
  prompt: string,
  opts?: {
    model?: string;
    responseMimeType?: "application/json";
    responseSchema?: unknown;
  },
): Promise<string> {
  const ai = createGeminiClient();
  const model = opts?.model ?? getGeminiModel();

  const response = await ai.models.generateContent({
    model,
    contents: prompt,
    config:
      opts?.responseMimeType || opts?.responseSchema
        ? {
            responseMimeType: opts.responseMimeType,
            responseSchema: opts.responseSchema,
          }
        : undefined,
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

function stripCodeFence(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  return fenced?.[1]?.trim() ?? text.trim();
}

export async function generateGeminiJson<TSchema extends z.ZodTypeAny>(
  prompt: string,
  schema: TSchema,
  opts?: {
    model?: string;
    nativeStructuredOutput?: {
      responseSchema: unknown;
    };
  },
): Promise<z.infer<TSchema>> {
  const text = await generateGeminiText(
    `${prompt}\n\nReturn only valid JSON that matches the requested shape.`,
    {
      model: opts?.model,
      responseMimeType: opts?.nativeStructuredOutput
        ? "application/json"
        : undefined,
      responseSchema: opts?.nativeStructuredOutput?.responseSchema,
    },
  );
  const raw = stripCodeFence(text);

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch {
    throw new Error("Gemini returned non-JSON content");
  }

  const parsed = schema.safeParse(parsedJson);
  if (!parsed.success) {
    throw new Error(parsed.error.issues.map((i) => i.message).join(" "));
  }
  return parsed.data;
}
