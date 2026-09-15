/** Local mode needs no credentials. Remote token mode keeps the bearer only
 *  in page memory; neither mode stores credentials in cookies or localStorage. */
import { ApiError, type CommitResponse } from "./types";
import { t } from "./i18n";

export interface ProjectLite {
  id: string;
  name: string;
  objective: string;
  revision: number;
  created_at?: string;
  updated_at?: string;
}

let token: string | null = null;
export function setToken(value: string | null) { token = value; }
export function hasToken() { return token !== null; }

function checkSession(res: Response, path: string) {
  if (res.status === 401 && path !== "/api/v1/session" && !path.startsWith("/api/v1/session?")) {
    window.dispatchEvent(new Event("rm:unauthorized"));
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-researchmap-request": "1",
    ...(init.headers as Record<string, string> | undefined),
  };
  if (token) headers["authorization"] = `Bearer ${token}`;
  let res: Response;
  try {
    res = await fetch(path, { ...init, headers, credentials: "same-origin" });
  } catch (e) {
    throw new ApiError(0, "NETWORK", t("api.err.network"), { detail: String(e) });
  }
  checkSession(res, path);
  const text = await res.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      /* non-JSON (should not happen on /api) */
    }
  }
  if (!res.ok) {
    const e = (body as { error?: { code?: string; message?: string; details?: Record<string, unknown> } } | null)?.error;
    throw new ApiError(
      res.status,
      e?.code ?? "UNKNOWN",
      e?.message ?? `HTTP ${res.status}`,
      e?.details ?? {},
    );
  }
  return (body ?? null) as T;
}

const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, data: unknown) =>
    request<T>(path, { method: "POST", body: JSON.stringify(data) }),
  health: () => fetch("/healthz").then(async (r) => (r.ok ? true : false)),
  session: () => request<{ actor: string; app_version: string; auth_mode: "local" | "token" }>("/api/v1/session"),
  // The manager must include projects beyond the API's default first 50.
  projects: async (): Promise<{ items: ProjectLite[] }> => {
    for (let attempt = 0; ; attempt++) {
      try {
        const items: ProjectLite[] = [];
        let cursor: string | null = null;
        do {
          const page: { items: ProjectLite[]; next_cursor: string | null } = await request(
            `/api/v1/projects?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
          );
          items.push(...page.items);
          cursor = page.next_cursor;
        } while (cursor);
        return { items };
      } catch (e) {
        if (attempt === 0 && e instanceof ApiError && e.code === "PAGINATION_STALE") continue;
        throw e;
      }
    }
  },
  project: (pid: string) => request<{ id: string; name: string; objective: string; revision: number } & Record<string, unknown>>(`/api/v1/projects/${pid}`),
  graph: (pid: string, opts: { includeArchived?: boolean } = {}) => {
    const p = new URLSearchParams();
    if (opts.includeArchived) p.set("include_archived", "true");
    const qs = p.toString();
    return request<import("./types").GraphResponse>(
      `/api/v1/projects/${pid}/graph${qs ? `?${qs}` : ""}`,
    );
  },
  node: (pid: string, nid: string) => request<import("./types").NodeFull>(`/api/v1/projects/${pid}/nodes/${nid}`),
  nodeRelations: (pid: string, nid: string, opts: { cursor?: string; includeArchived?: boolean; limit?: number } = {}) => {
    const p = new URLSearchParams();
    if (opts.cursor) p.set("cursor", opts.cursor);
    p.set("limit", String(opts.limit ?? 20));
    if (opts.includeArchived) p.set("include_archived", "true");
    return request<import("./types").Paged<import("./types").RelationItem>>(
      `/api/v1/projects/${pid}/nodes/${nid}/relations?${p.toString()}`,
    );
  },
  search: (pid: string, q: string, limit = 30) =>
    request<import("./types").Paged<import("./types").SearchItem> & { total: number; query: string }>(
      `/api/v1/projects/${pid}/search?q=${encodeURIComponent(q)}&limit=${limit}`,
    ),
  commits: (pid: string, opts: { nodeId?: string; limit?: number; cursor?: string } = {}) => {
    const p = new URLSearchParams();
    p.set("limit", String(opts.limit ?? 20));
    if (opts.nodeId) p.set("node_id", opts.nodeId);
    if (opts.cursor) p.set("cursor", opts.cursor);
    return request<import("./types").Paged<import("./types").CommitItem>>(
      `/api/v1/projects/${pid}/commits?${p.toString()}`,
    );
  },
  commitDetail: (pid: string, cid: string) =>
    request<import("./types").CommitDetail>(`/api/v1/projects/${pid}/commits/${cid}`),
  context: (pid: string, opts: { focus?: string; q?: string; maxChars?: number } = {}) => {
    const p = new URLSearchParams();
    if (opts.focus) p.set("focus_node_id", opts.focus);
    if (opts.q) p.set("q", opts.q);
    p.set("max_chars", String(opts.maxChars ?? 12000));
    return request<Record<string, unknown>>(`/api/v1/projects/${pid}/context?${p.toString()}`);
  },
  createProject: (body: { request_id: string; name: string; objective: string }) =>
    api.post<{ id: string; revision: number; name: string; already_committed?: boolean }>(
      "/api/v1/projects",
      body,
    ),
  commit: (pid: string, body: import("./types").CommitRequest, dryRun = false) =>
    api.post<CommitResponse>(
      `/api/v1/projects/${pid}/commits${dryRun ? "?dry_run=true" : ""}`,
      body,
    ),
  exportBlob: async (pid: string) => {
    const headers: Record<string, string> = { "x-researchmap-request": "1" };
    if (token) headers["authorization"] = `Bearer ${token}`;
    const res = await fetch(`/api/v1/projects/${pid}/export`, { headers });
    checkSession(res, "attachment-or-export");
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as {
        error?: { code?: string; message?: string; details?: Record<string, unknown> };
      } | null;
      throw new ApiError(res.status, body?.error?.code ?? "UNKNOWN", body?.error?.message ?? `HTTP ${res.status}`, body?.error?.details ?? {});
    }
    return res.blob();
  },
  /** Managed bytes follow the same local/token access guard. */
  attachmentBlob: async (aid: string) => {
    const headers: Record<string, string> = { "x-researchmap-request": "1" };
    if (token) headers["authorization"] = `Bearer ${token}`;
    const res = await fetch(`/api/v1/attachments/${aid}`, { headers });
    checkSession(res, "attachment-or-export");
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as {
        error?: { code?: string; message?: string; details?: Record<string, unknown> };
      } | null;
      throw new ApiError(res.status, body?.error?.code ?? "UNKNOWN", body?.error?.message ?? `HTTP ${res.status}`, body?.error?.details ?? {});
    }
    return res.blob();
  },
  /** D3: multipart upload → staged attachment row (route-level 10MB/pixel
   *  checks live server-side; here just a plain multipart POST). */
  uploadAttachment: async (pid: string, file: File) => {
    const headers: Record<string, string> = { "x-researchmap-request": "1" };
    if (token) headers["authorization"] = `Bearer ${token}`;
    const fd = new FormData();
    fd.append("file", file);
    let res: Response;
    try {
      res = await fetch(`/api/v1/projects/${pid}/attachments`, { method: "POST", headers, body: fd });
    } catch (e) {
      throw new ApiError(0, "NETWORK", t("api.err.network"), { detail: String(e) });
    }
    const text = await res.text();
    let body: unknown = null;
    try { body = text ? JSON.parse(text) : null; } catch { /* non-JSON */ }
    checkSession(res, "attachment-or-export");
    if (!res.ok) {
      const e = (body as { error?: { code?: string; message?: string; details?: Record<string, unknown> } } | null)?.error;
      throw new ApiError(res.status, e?.code ?? "UNKNOWN", e?.message ?? `HTTP ${res.status}`, e?.details ?? {});
    }
    return body as {
      id: string; project_id: string; mime: string; bytes: number;
      sha256: string; width: number | null; height: number | null;
      original_name: string | null; state: string;
      created_by: string; created_at: string;
    };
  },
};

export const uuidv4 = (): string =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
      });

export default api;