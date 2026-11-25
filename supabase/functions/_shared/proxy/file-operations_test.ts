import {getExport,trashFile} from "./file-operations.ts";
function assert(v:unknown){if(!v)throw Error("Assertion failed");}
Deno.test("download metadata requires owner",async()=>{
 try{await getExport("abc","token",async()=>Response.json({name:"x",mimeType:"application/pdf",owners:[{me:false}]}));throw Error("Expected rejection");}
 catch(e){assert((e as Error).message==="File must be owned by you");}
});
Deno.test("document export uses docx",async()=>{
 const info=await getExport("abc","token",async()=>Response.json({name:"Report",mimeType:"application/vnd.google-apps.document",owners:[{me:true}]}));
 assert(info.name==="Report.docx"&&info.url.includes("/export?mimeType="));
});
Deno.test("trash only owned file",async()=>{
 let count=0;
 const output=await trashFile("abc","token",async(_url,init)=>{
 count++;if(count===1)return Response.json({owners:[{me:true}],trashed:false});
 assert(init?.method==="PATCH"&&JSON.parse(String(init.body)).trashed===true);
 return Response.json({});
 });
 assert(output.trashed&&count===2);
});
