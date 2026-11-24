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
  const started = Date.now();
  const response = await fetch("https://generativelanguage.googleapis.com/v1beta/models/" + encodeURIComponent(model) + ":generateContent", {
    method: "POST", headers: {"Content-Type":"application/json", "x-goog-api-key":secret("GEMINI_API_KEY")},
    body: JSON.stringify({contents:[{parts:[{text:input.prompt}]}], generationConfig:{maxOutputTokens:2048}}),
    signal: AbortSignal.timeout(45000)
  });
  const metadata = {provider:"Gemini", model, status:response.status, durationMs:Date.now()-started};
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    const detail = payload?.error;
    const raw = detail?.status;
    const errorType = typeof raw === "string" && /^[A-Za-z_]{1,80}$/.test(raw) ? raw : undefined;
    const message = typeof detail?.message === "string" ? detail.message : "";
    // Classify known provider messages without logging arbitrary text or user data.
    const reason = /overload|high demand|capacity/i.test(message) ? "capacity" :
      /quota|rate limit/i.test(message) ? "quota" :
      /not found|not supported/i.test(message) ? "not_found_or_unsupported" :
      /verify|verified|testing emails/i.test(message) ? "verification" :
      /permission|unauthorized|api key/i.test(message) ? "authorization" : "unknown";
    console.error(JSON.stringify({...metadata, event:"provider_error", errorType, reason}));
    throw new HttpError(502, "Gemini request failed (" + response.status + ")");
  }
  console.info(JSON.stringify({...metadata, event:"provider_success"}));
  const result = await response.json();
  const content = result.candidates?.[0]?.content?.parts?.filter((p: any) => !p.thought && typeof p.text === "string").map((p: any) => p.text).join("\n");
  if (!content?.trim()) throw new HttpError(502, "Gemini returned no text");
  return content;
}
