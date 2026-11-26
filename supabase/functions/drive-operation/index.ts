import { authorize, cors } from "../_shared/proxy/actions-common.ts";
import { OperationRepository } from "../_shared/proxy/operations.ts";
import { requestCancellation, cleanupAfterWorkerStopped } from "../_shared/proxy/operation-cancel.ts";
import { copyFile, parseLink } from "../_shared/proxy/drive.ts";
import { ProxyError } from "../_shared/proxy/engine.ts";
Deno.serve(async req => {
  const c = cors(req);
  if (c.error) return c.error;
  try {
    const {token,payload,subject} = await authorize(req,c.clientId!,"drive-operation");
    const id = payload?.operationId;
    if (typeof id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return c.reply({error:"Invalid operation ID"},400);
    const repo = new OperationRepository(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    if (payload.action === "status" || payload.action === "cancel") {
      const op = await repo.get(id,subject);
      if (!op) return c.reply({error:"Operation not found"},404);
      const state = payload.action === "cancel" ? await requestCancellation(repo,id,subject) : op.state;
      return c.reply({operationId:id,state});
    }
    if (payload.action !== "start" || typeof payload.link !== "string" || payload.link.length > 4096) return c.reply({error:"Invalid request"},400);
    parseLink(payload.link);
    let op = await repo.get(id,subject);
    if (!op) {
      try { op = await repo.create(id,subject,payload.link,"copy"); }
      catch { op = await repo.get(id,subject); if (!op) throw new Error("Operation creation failed"); }
    }
    if (op.source_link !== payload.link || op.mode !== "copy") return c.reply({error:"Operation conflict"},409);
    const claimed = await repo.transition(id,subject,"pending","running");
    if (!claimed) return c.reply({operationId:id,state:(await repo.get(id,subject))?.state},202);
    // An ambiguous upstream failure deliberately leaves the operation unresolved.
    // Do not repeat a copy or claim cancellation until reconciliation is safe.
    const file = await copyFile(payload.link,token,fetch,id);
    await repo.recordFile(id,subject,file.id);
    const done = await repo.transition(id,subject,"running","succeeded");
    if (done) return c.reply({operationId:id,state:done.state,file});
    const state = await cleanupAfterWorkerStopped(repo,id,subject,token);
    return c.reply({operationId:id,state});
  } catch (error) {
    return error instanceof ProxyError ? c.reply({error:error.message},error.status) : c.reply({error:"Operation unresolved; check status"},500);
  }
});
