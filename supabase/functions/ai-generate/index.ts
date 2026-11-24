import { generate } from "../_shared/ai-service.ts";
import { handler } from "../_shared/http.ts";
Deno.serve(handler(async (body) => ({content:await generate(body)})));
