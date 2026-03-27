import { createGeminiClient } from "./client";
import { getGeminiModel } from "./env";
import type { z } from "zod";

export async function generateGeminiText(
  prompt: string,
  opts?: {
    model?: string;
    /** When omitted but a schema is set, defaults to `application/json` (required by the API). */
    responseMimeType?: string;
    /** OpenAPI 3.0 subset schema (Gemini `Schema`). Mutually exclusive with `responseJsonSchema`. */
    responseSchema?: unknown;
    /** [JSON Schema](https://json-schema.org/) subset for structured output. Mutually exclusive with `responseSchema`. */
    responseJsonSchema?: unknown;
  },
): Promise<string> {
  const ai = createGeminiClient();
  const model = opts?.model ?? getGeminiModel();

  if (
    opts?.responseSchema !== undefined &&
    opts?.responseJsonSchema !== undefined
  ) {
    throw new Error(
      "Pass only one of responseSchema or responseJsonSchema (mutually exclusive in the Gemini API)",
    );
  }

  const responseMimeType =
    opts?.responseMimeType ??
    (opts?.responseSchema !== undefined ||
    opts?.responseJsonSchema !== undefined
      ? "application/json"
      : undefined);

  const needsConfig =
    responseMimeType !== undefined ||
    opts?.responseSchema !== undefined ||
    opts?.responseJsonSchema !== undefined;

  const response = await ai.models.generateContent({
    model,
    contents: prompt,
    config: needsConfig
      ? {
          ...(responseMimeType ? { responseMimeType } : {}),
          ...(opts?.responseSchema !== undefined
            ? { responseSchema: opts.responseSchema }
            : {}),
          ...(opts?.responseJsonSchema !== undefined
            ? { responseJsonSchema: opts.responseJsonSchema }
            : {}),
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
      /** OpenAPI-style `Schema` (SDK `SchemaUnion`). */
      responseSchema?: unknown;
      /** JSON Schema object; correct API field is `responseJsonSchema`. */
      responseJsonSchema?: unknown;
    };
  },
): Promise<z.infer<TSchema>> {
  const so = opts?.nativeStructuredOutput;
  if (
    so?.responseSchema !== undefined &&
    so?.responseJsonSchema !== undefined
  ) {
    throw new Error(
      "nativeStructuredOutput: pass only one of responseSchema or responseJsonSchema",
    );
  }

  const augmentedPrompt = so
    ? prompt
    : `${prompt}\n\nReturn only valid JSON that matches the requested shape.`;

  const text = await generateGeminiText(augmentedPrompt, {
    model: opts?.model,
    responseMimeType: so ? "application/json" : undefined,
    responseSchema: so?.responseSchema,
    responseJsonSchema: so?.responseJsonSchema,
  });
  const raw = stripCodeFence(text);

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch {
    const maxLog = 8000;
    const logged =
      raw.length > maxLog
        ? `${raw.slice(0, 4000)}\n… [truncated ${raw.length} chars total] …\n${raw.slice(-3000)}`
        : raw;
    console.error("[gemini] generateGeminiJson: JSON.parse failed", {
      model: opts?.model,
      usedNativeStructuredOutput: Boolean(opts?.nativeStructuredOutput),
      rawLength: raw.length,
      raw: logged,
    });
    throw new Error(
      `Gemini returned non-JSON content (${raw.length} chars). Check server logs for [gemini] generateGeminiJson: JSON.parse failed.`,
    );
  }

  const parsed = schema.safeParse(parsedJson);
  if (!parsed.success) {
    console.error("[gemini] generateGeminiJson: Zod validation failed", {
      model: opts?.model,
      parsedJson,
      issues: parsed.error.issues,
    });
    throw new Error(parsed.error.issues.map((i) => i.message).join(" "));
  }
  return parsed.data;
}
