import { GoogleGenAI } from "@google/genai";

import { getGeminiApiKey } from "./env";

export function createGeminiClient() {
  // Server-only: keep API key off the client bundle.
  return new GoogleGenAI({ apiKey: getGeminiApiKey() });
}
