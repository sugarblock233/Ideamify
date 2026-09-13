/** Thin API client. The bearer token lives ONLY in page memory (SPEC 9):
 *  no Cookie, no localStorage, no URL, no logs. */

import { ApiError, type CommitResponse } from "./types";

let token: string | null = null;

export function setToken(t: string | null) {
  token = t;
}

export function hasToken(): boolean {
  return token !== null;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    ...(init.headers as Record<string, string> | undefined),
  };
  if (token) headers["authorization"] = `Bearer ${token}`;
  let res: Response;
  try {
    res = await fetch(path, { ...init, headers });
  } catch (e) {
    throw new ApiError(0, "NETWORK", "无法连接服务器，请检查网络", { detail: String(e) });
  }
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
  session: () => request<{ actor: string; app_version: string }>("/api/v1/session"),
  projects: () =>
    request<{ items: { id: string; name: string; objective: string; revision: number }[] }>(
      "/api/v1/projects",
    ),
  project: (pid: string) => request<{ id: string; name: string; objective: string; revision: number } & Record<string, unknown>>(`/api/v1/projects/${pid}`),
  graph: (pid: string) => request<import("./types").GraphResponse>(`/api/v1/projects/${pid}/graph`),
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
    const headers: Record<string, string> = {};
    if (token) headers["authorization"] = `Bearer ${token}`;
    const res = await fetch(`/api/v1/projects/${pid}/export`, { headers });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as {
        error?: { code?: string; message?: string; details?: Record<string, unknown> };
      } | null;
      throw new ApiError(res.status, body?.error?.code ?? "UNKNOWN", body?.error?.message ?? `HTTP ${res.status}`, body?.error?.details ?? {});
    }
    return res.blob();
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