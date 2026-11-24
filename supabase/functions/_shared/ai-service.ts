export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export function secret(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new HttpError(503, "Missing server configuration: " + name);
  return value;
}
export async function generate(input: any): Promise<string> {
  if (!input || input.provider !== "gemini" || typeof input.prompt !== "string" || !input.prompt.trim() || input.prompt.length > 20000)
    throw new HttpError(400, "Expected Gemini provider and prompt (max 20000 characters)");
  const model = Deno.env.get("AI_GEMINI_MODEL") || "gemini-flash-latest";
  if (input.model !== undefined && input.model !== model) throw new HttpError(400, "Model not allowed");
  const response = await fetch("https://generativelanguage.googleapis.com/v1beta/models/" + encodeURIComponent(model) + ":generateContent", {
    method: "POST", headers: {"Content-Type":"application/json", "x-goog-api-key":secret("GEMINI_API_KEY")},
    body: JSON.stringify({contents:[{parts:[{text:input.prompt}]}], generationConfig:{maxOutputTokens:2048}}),
    signal: AbortSignal.timeout(45000)
  });
  if (!response.ok) throw new HttpError(502, "Gemini request failed (" + response.status + ")");
  const result = await response.json();
  const content = result.candidates?.[0]?.content?.parts?.filter((p: any) => !p.thought && typeof p.text === "string").map((p: any) => p.text).join("\n");
  if (!content?.trim()) throw new HttpError(502, "Gemini returned no text");
  return content;
}
