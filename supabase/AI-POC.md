# AI email POC
Deploy only the new functions to project tunistslilxckcjxnlrm.
Set GEMINI_API_KEY, RESEND_API_KEY, ALLOWED_EMAIL and a random high-entropy AI_GATEWAY_KEY in the Supabase Edge Function Secrets dashboard. Optional AI_GEMINI_MODEL (default gemini-flash-latest) and AI_EMAIL_FROM (default onboarding@resend.dev). Resend test sender only supports the account's own verified recipient. Never commit secrets.

From repository root:
```sh
npx supabase@latest functions deploy ai-generate --project-ref tunistslilxckcjxnlrm --no-verify-jwt
npx supabase@latest functions deploy ai-to-email --project-ref tunistslilxckcjxnlrm --no-verify-jwt
```
JWT verification is replaced by mandatory server-side x-ai-gateway-key authentication. Do not expose this key in a frontend.

POST https://tunistslilxckcjxnlrm.supabase.co/functions/v1/ai-to-email
Headers: Content-Type: application/json, x-ai-gateway-key: YOUR_SECRET
```json
{"ai":{"provider":"gemini","prompt":"Explain Angular Signals in two sentences"},"email":{"to":"YOUR_ALLOWED_EMAIL","subject":"AI POC"}}
```
For ai-generate, POST just the ai object. Expect 401 with an incorrect gateway key, 400 for a disallowed recipient, and 200 with status accepted and emailId on successful submission. Verify actual delivery in inbox. Do not blindly retry after timeout: duplicate emails are possible. No database changes. No browser CORS support; intended for server/CLI use. No production rate limiting yet.
