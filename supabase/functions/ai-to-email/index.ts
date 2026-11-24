import { generate, secret } from "../_shared/ai-service.ts";
import { handler } from "../_shared/http.ts";
import { validateEmail, sendEmail } from "../_shared/email-service.ts";
Deno.serve(handler(async (body) => {
  validateEmail(body?.email);
  secret("RESEND_API_KEY");
  const content = await generate(body?.ai);
  const emailId = await sendEmail(body.email, content);
  return {status:"accepted", emailId};
}));
