export type OperationState = "pending" | "running" | "cancel_requested" | "cleaning" | "cancelled" | "succeeded" | "failed" | "cleanup_failed";
export type OperationMode = "copy" | "download" | "both";
export interface Operation {
  id: string;
  owner_subject: string;
  source_link: string;
  mode: OperationMode;
  state: OperationState;
  completed_items: number;
  total_items: number | null;
}
const transitions: Record<OperationState, OperationState[]> = {
  pending: ["running", "cancel_requested", "failed"],
  running: ["cancel_requested", "succeeded", "failed"],
  cancel_requested: ["cleaning"],
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
  async transition(id: string, owner: string, from: OperationState, to: OperationState): Promise<Operation | null> {
    if (!transitions[from]?.includes(to)) throw new Error("Invalid operation transition");
    const params = this.scope(id, owner);
    params.set("state", "eq." + from);
    return (await this.query<Operation>("drive_operations", params, "PATCH",
      { state: to, updated_at: new Date().toISOString() }))[0] ?? null;
  }
}
