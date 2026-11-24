import { HttpError, secret } from "./ai-service.ts";
export function validateEmail(email: any) {
  if (!email || typeof email.to !== "string" || email.to.toLowerCase() !== secret("ALLOWED_EMAIL").toLowerCase() || typeof email.subject !== "string" || !email.subject.trim() || email.subject.length > 200 || /[\r\n]/.test(email.subject))
    throw new HttpError(400, "Invalid email or recipient not allowed");
}
export async function sendEmail(email: any, text: string) {
  validateEmail(email);
  const response = await fetch("https://api.resend.com/emails", {
    method:"POST", headers:{"Authorization":"Bearer " + secret("RESEND_API_KEY"),"Content-Type":"application/json"},
    body:JSON.stringify({from:Deno.env.get("AI_EMAIL_FROM") || "onboarding@resend.dev",to:[email.to],subject:email.subject,text}),
    signal:AbortSignal.timeout(15000)
  });
  if (!response.ok) throw new HttpError(502,"Resend request failed (" + response.status + ")");
  const result = await response.json();
  if (!result.id) throw new HttpError(502,"Resend returned no message ID");
  return result.id;
}
