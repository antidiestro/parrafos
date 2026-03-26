# `src/lib/gemini`

## Purpose
- Gemini integration wrapper for text generation and schema-validated JSON extraction.
- LangSmith tracing is enabled through LangChain's Gemini wrapper (`wrapGemini`) in `client.ts`.

## Key Files
- `client.ts`: creates and wraps `GoogleGenAI` with LangSmith tracing.
- `env.ts`: API key + default model lookup (`GEMINI_MODEL` override) + LangSmith tracing metadata/tags.
- `generate.ts`:
  - `generateGeminiText(prompt, opts)`
  - `generateGeminiJson(prompt, schema, opts)`

## Contracts and Invariants
- Empty text responses throw.
- JSON extraction:
  - appends strict JSON-only instruction when **`nativeStructuredOutput` is not** set (structured responses rely on API `application/json` + schema instead)
  - can request native structured output: `application/json` plus **`responseJsonSchema`** for JSON Schema objects (or **`responseSchema`** for OpenAPI-style Gemini schemas — mutually exclusive)
  - strips optional markdown code fences
  - parses JSON and validates with Zod schema
- Errors are surfaced with useful messages for caller-level handling.
- When `JSON.parse` fails on model text, or Zod validation fails, details are **`console.error`**-logged under `[gemini] generateGeminiJson:` (including a length-bounded raw string for parse failures).

## Common Changes
- Prompt behavior changes: update callers and this module docs together.
- Model default changes: update `env.ts` and operational docs if needed.
- Schema updates: keep caller-side expectations in sync with parse output.

## Verification
- Exercise affected API route or worker flow.
- `npm run lint`
- `npx tsc --noEmit`

## Environment for Tracing
- `LANGSMITH_API_KEY`
- `LANGSMITH_PROJECT` (optional, defaults to `default` if omitted by LangSmith)
- `LANGSMITH_TRACING=true`
- `LANGSMITH_GEMINI_TAGS` (optional comma-separated tags)

## Gotchas
- Keep API key server-only.
- Model output drift can break strict schema parsing; test with realistic samples.
