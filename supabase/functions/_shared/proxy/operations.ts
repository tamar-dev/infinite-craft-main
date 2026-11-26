export type OperationState = "pending" | "running" | "cancel_requested" | "cleaning" | "cancelled" | "succeeded" | "failed" | "cleanup_failed" | "ready" | "finalizing" | "uncertain" | "dispatching";
export type OperationMode = "copy" | "download" | "both";
export interface Operation {
  id: string;
  owner_subject: string;
  source_link: string;
  mode: OperationMode;
  state: OperationState;
  completed_items: number;
  total_items: number | null;
  result_id?: string | null;
  result_name?: string | null;
}
const transitions: Record<OperationState, OperationState[]> = {
  pending: ["running", "cancelled", "failed"],
  running: ["dispatching", "cancelled", "failed", "cancel_requested"],
  dispatching: ["cancel_requested", "succeeded", "ready", "uncertain"],
  uncertain: ["cancel_requested", "succeeded", "ready"],
  ready: ["cancel_requested", "succeeded", "finalizing"],
  finalizing: ["succeeded"],
  cancel_requested: ["cleaning", "cancelled"],
  cleaning: ["cancelled", "cleanup_failed"],
  cleanup_failed: ["cleaning"],
  cancelled: [], succeeded: [], failed: []
};
export class OperationRepository {
  constructor(private url: string, private key: string, private request: typeof fetch = fetch) {}
  private async query<T>(table: string, params: URLSearchParams, method = "GET", body?: unknown): Promise<T[]> {
    const response = await this.request(new URL("/rest/v1/" + table + "?" + params, this.url), {
      method, headers: { apikey: this.key, Authorization: "Bearer " + this.key,
        "Content-Type": "application/json", Prefer: "return=representation" },
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: "error", signal: AbortSignal.timeout(10000)
    });
    if (!response.ok) throw new Error("Operation storage unavailable");
    return await response.json() as T[];
  }
  private scope(id: string, owner: string): URLSearchParams {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id) || !owner)
      throw new Error("Invalid operation identity");
    return new URLSearchParams({ id: "eq." + id, owner_subject: "eq." + owner });
  }
  async get(id: string, owner: string): Promise<Operation | null> {
    return (await this.query<Operation>("drive_operations", this.scope(id, owner)))[0] ?? null;
  }
  async create(id: string, owner: string, link: string, mode: OperationMode): Promise<Operation> {
    this.scope(id, owner);
    const rows = await this.query<Operation>("drive_operations", new URLSearchParams(), "POST",
      { id, owner_subject: owner, source_link: link, mode });
    if (!rows[0]) throw new Error("Operation creation failed");
    return rows[0];
  }
  async transition(id: string, owner: string, from: OperationState, to: OperationState, result?: {id:string;name:string}): Promise<Operation | null> {
    if (!transitions[from]?.includes(to)) throw new Error("Invalid operation transition");
    const params = this.scope(id, owner);
    params.set("state", "eq." + from);
    return (await this.query<Operation>("drive_operations", params, "PATCH",
      { state: to, updated_at: new Date().toISOString(), ...(result ? {result_id:result.id,result_name:result.name,completed_items:1,total_items:1} : {}) }))[0] ?? null;
  }

  // Only trusted server code may register IDs returned by Google Drive.
  async recordFile(id: string, owner: string, fileId: string): Promise<void> {
    if (!/^[A-Za-z0-9_-]{1,256}$/.test(fileId)) throw new Error("Invalid Drive file ID");
    const operation = await this.get(id, owner);
    if (!operation || !["running", "cancel_requested"].includes(operation.state))
      throw new Error("Operation not accepting files");
    await this.query("drive_operation_files", new URLSearchParams(), "POST",
      { operation_id: id, file_id: fileId });
  }
  async listPendingFiles(id: string, owner: string): Promise<string[]> {
    if (!await this.get(id, owner)) throw new Error("Operation not found");
    const rows = await this.query<{file_id: string}>("drive_operation_files",
      new URLSearchParams({ operation_id: "eq." + id, cleaned_at: "is.null", select: "file_id", order: "created_at.desc,file_id.desc", limit: "100" }));
    return rows.map(row => row.file_id);
  }
  async markCleaned(id: string, owner: string, fileId: string): Promise<void> {
    const operation = await this.get(id, owner);
    if (!operation || operation.state !== "cleaning") throw new Error("Operation not cleaning");
    const rows = await this.query("drive_operation_files",
      new URLSearchParams({ operation_id: "eq." + id, file_id: "eq." + fileId }), "PATCH",
      { cleaned_at: new Date().toISOString() });
    if (!rows.length) throw new Error("File not registered");
  }
}
