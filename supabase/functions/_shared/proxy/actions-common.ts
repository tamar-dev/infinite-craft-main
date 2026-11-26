import { ProxyError } from "./engine.ts";
import { verifyGoogleToken, RateLimiter } from "./auth.ts";
import { takeDistributed, userBucket } from "./rate-limit.ts";
const ingress = new RateLimiter(120, 60000);
export function cors(req:Request) {
 const allowed=Deno.env.get("DRIVE_COPY_EXTENSION_ORIGIN");
 const clientId=Deno.env.get("DRIVE_COPY_OAUTH_CLIENT_ID");
 const headers=new Headers({"Content-Type":"application/json","Cache-Control":"no-store","Vary":"Origin"});
 const reply=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers});
 if(!allowed||!clientId||!/^chrome-extension:\/\/[a-p]{32}$/.test(allowed))
   return {headers,reply,error:reply({error:"Service not configured"},503)};
 const origin=req.headers.get("origin");
 if(origin&&origin!==allowed)return {headers,reply,error:reply({error:"Origin not allowed"},403)};
 headers.set("Access-Control-Allow-Origin",allowed);
 headers.set("Access-Control-Allow-Methods","POST, OPTIONS");
 headers.set("Access-Control-Allow-Headers","authorization, content-type");
 if(req.method==="OPTIONS")return {headers,reply,error:new Response(null,{status:204,headers})};
 if(req.method!=="POST")return {headers,reply,error:reply({error:"Method not allowed"},405)};
 return {headers,reply,clientId};
}
export async function authorize(req:Request,clientId:string,kind:string) {
 const token=req.headers.get("authorization")?.match(/^Bearer ([A-Za-z0-9._~+\/=-]{1,4096})$/i)?.[1];
 if(!token)throw new ProxyError(401,"Google access token required");
 if(!req.headers.get("content-type")?.toLowerCase().startsWith("application/json"))throw new ProxyError(415,"JSON required");
 const reader=req.body?.getReader();if(!reader)throw new ProxyError(400,"Body required");
 const decoder=new TextDecoder();let raw="",size=0;
 while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>8192){await reader.cancel();throw new ProxyError(413,"Body too large");}raw+=decoder.decode(value,{stream:true});}
 raw+=decoder.decode();
 let payload;try{payload=JSON.parse(raw);}catch{throw new ProxyError(400,"Invalid JSON");}
 if(!ingress.take("global"))throw new ProxyError(429,"Too many requests");
 const url=Deno.env.get("SUPABASE_URL")??"",key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")??"";
 if(!await takeDistributed(kind+":global",120,url,key))throw new ProxyError(429,"Too many requests");
 const subject=await verifyGoogleToken(token,clientId);
 const userKind=kind==="drive-operation"?(payload?.action==="start"?"drive-operation:start":"drive-operation:control"):kind;
 const userLimit=userKind==="drive-operation:control"||kind==="drive-folder"?60:10;
 if(!await takeDistributed((await userBucket(subject))+":"+userKind,userLimit,url,key))throw new ProxyError(429,"Too many requests");
 return {token,payload,subject};
}
