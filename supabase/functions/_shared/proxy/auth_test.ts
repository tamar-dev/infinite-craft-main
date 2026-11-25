import { verifyGoogleToken, RateLimiter } from "./auth.ts";
import { takeDistributed, userBucket } from "./rate-limit.ts";
function assert(v: unknown) { if (!v) throw new Error("Assertion failed"); }
async function rejects(fn:()=>Promise<unknown>,status:number) {
  try { await fn(); } catch(e) { assert((e as {status:number}).status===status); return; }
  throw new Error("Expected rejection");
}
Deno.test("valid token",async()=>assert(await verifyGoogleToken("test","client",async()=>Response.json({aud:"client",expires_in:60,sub:"user"}))==="user"));
Deno.test("wrong audience",async()=>await rejects(()=>verifyGoogleToken("test","client",async()=>Response.json({aud:"other",expires_in:60,sub:"user"})),401));
Deno.test("expired token",async()=>await rejects(()=>verifyGoogleToken("test","client",async()=>Response.json({aud:"client",expires_in:0,sub:"user"})),401));
Deno.test("wrong authorized party",async()=>await rejects(()=>verifyGoogleToken("test","client",async()=>Response.json({aud:"client",azp:"other",expires_in:60,sub:"user"})),401));
Deno.test("Drive fallback",async()=>{
  let calls=0;
  const id=await verifyGoogleToken("test","client",async()=>Response.json(++calls===1?{aud:"client",expires_in:60}:{user:{permissionId:"drive-user"}}));
  assert(id==="drive-user" && calls===2);
});
Deno.test("local limiter resets",()=>{const r=new RateLimiter(2,100);assert(r.take("a",0)&&r.take("a",1)&&!r.take("a",2)&&r.take("a",100));});
Deno.test("distributed limiter respects denial",async()=>assert(!await takeDistributed("bucket",10,"https://example.com","test",async()=>Response.json(false))));
Deno.test("distributed limiter fails closed",async()=>await rejects(()=>takeDistributed("bucket",10,"https://example.com","test",async()=>new Response(null,{status:500})),503));
Deno.test("bucket hashes identity",async()=>{const a=await userBucket("user");assert(a===await userBucket("user")&&a!==await userBucket("other")&&!a.endsWith("user"));});
