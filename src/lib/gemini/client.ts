import { GoogleGenAI } from "@google/genai";
import { wrapGemini } from "langsmith/wrappers/gemini";

import { getGeminiApiKey, getGeminiTracingExtra } from "./env";

let geminiClient: GoogleGenAI | null = null;

export function createGeminiClient() {
  if (geminiClient) {
    return geminiClient;
  }

  // Server-only: keep API key off the client bundle.
  const client = new GoogleGenAI({ apiKey: getGeminiApiKey() });
  geminiClient = wrapGemini(client, getGeminiTracingExtra());
  return geminiClient;
}
