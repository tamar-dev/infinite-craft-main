import { HttpError, secret } from "./ai-service.ts";
export function validateEmail(email: any) {
  if (!email || typeof email.to !== "string" || email.to.toLowerCase() !== secret("ALLOWED_EMAIL").toLowerCase() || typeof email.subject !== "string" || !email.subject.trim() || email.subject.length > 200 || /[\r\n]/.test(email.subject))
    throw new HttpError(400, "Invalid email or recipient not allowed");
}
export async function sendEmail(email: any, text: string) {
  validateEmail(email);
  const started = Date.now();
  const response = await fetch("https://api.resend.com/emails", {
    method:"POST", headers:{"Authorization":"Bearer " + secret("RESEND_API_KEY"),"Content-Type":"application/json"},
    body:JSON.stringify({from:Deno.env.get("AI_EMAIL_FROM") || "onboarding@resend.dev",to:[email.to],subject:email.subject,text}),
    signal:AbortSignal.timeout(15000)
  });
  const metadata = {provider:"Resend", status:response.status, durationMs:Date.now()-started};
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    const detail = payload;
    const raw = detail?.name;
    const errorType = typeof raw === "string" && /^[A-Za-z_]{1,80}$/.test(raw) ? raw : undefined;
    const message = typeof detail?.message === "string" ? detail.message : "";
    // Classify known provider messages without logging arbitrary text or user data.
    const reason = /overload|high demand|capacity/i.test(message) ? "capacity" :
      /quota|rate limit/i.test(message) ? "quota" :
      /not found|not supported/i.test(message) ? "not_found_or_unsupported" :
      /verify|verified|testing emails/i.test(message) ? "verification" :
      /permission|unauthorized|api key/i.test(message) ? "authorization" : "unknown";
    console.error(JSON.stringify({...metadata, event:"provider_error", errorType, reason}));
    throw new HttpError(502, "Resend request failed (" + response.status + ")");
  }
  console.info(JSON.stringify({...metadata, event:"provider_success"}));
  const result = await response.json();
  if (!result.id) throw new HttpError(502,"Resend returned no message ID");
  return result.id;
}
