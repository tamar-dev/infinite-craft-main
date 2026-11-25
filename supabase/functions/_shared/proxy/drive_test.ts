import { copyFile, parseLink } from "./drive.ts";
import { forward } from "./engine.ts";
function assert(value: unknown) { if (!value) throw new Error("Assertion failed"); }
Deno.test("parse resource key", () => {
  const result = parseLink("https://drive.google.com/file/d/abc/view?resourcekey=xyz");
  assert(result.id === "abc" && result.key === "xyz");
});
Deno.test("reject external target before network", async () => {
  let called = false;
  try {
    await forward({origin:"https://www.googleapis.com",path:/^\//,methods:["GET"],headers:[]},"https://example.com/",{},async () => { called=true; return new Response(); });
    throw new Error("Expected rejection");
  } catch(e) { assert(e instanceof Error && e.message === "Target not allowed"); }
  assert(!called);
});
Deno.test("copy permitted file once to root", async () => {
  let count=0;
  const mock: typeof fetch = async (url,init) => {
    count++;
    assert(new Headers(init?.headers).get("authorization") === "Bearer test");
    assert(init?.redirect === "error");
    if(count===1) return Response.json({name:"Test",mimeType:"text/plain",capabilities:{canCopy:true}});
    assert(String(url).includes("/copy?") && init?.method === "POST");
    assert(JSON.parse(String(init?.body)).parents[0] === "root");
    return Response.json({id:"new"});
  };
  assert((await copyFile("https://drive.google.com/file/d/abc/view","test",mock)).id === "new");
  assert(count===2);
});
Deno.test("do not copy when owner forbids it", async () => {
  let count=0;
  try {
    await copyFile("https://drive.google.com/file/d/abc/view","test",async () => {count++;return Response.json({name:"Test",capabilities:{canCopy:false}});});
    throw new Error("Expected rejection");
  } catch(e) { assert(e instanceof Error && e.message === "Copying is not permitted"); }
  assert(count===1);
});
