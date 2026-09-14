/** API shapes — mirror backend/app/schemas.py (the authoritative contract). */

export type NodeKind = "question" | "idea" | "attempt" | "finding";
export type NodeStatus =
  | "unexplored"
  | "in_progress"
  | "promising"
  | "supported"
  | "not_supported"
  | "inconclusive";
export type RelationKind =
  | "related"
  | "motivates"
  | "supports"
  | "contradicts"
  | "depends_on";

export const RELATION_KINDS: RelationKind[] = [
  "related",
  "motivates",
  "supports",
  "contradicts",
  "depends_on",
];

export const NODE_STATUSES: NodeStatus[] = [
  "unexplored",
  "in_progress",
  "promising",
  "supported",
  "not_supported",
  "inconclusive",
];

export const NODE_KINDS: NodeKind[] = ["question", "idea", "attempt", "finding"];

export interface EvidenceItem {
  kind: "inline" | "url" | "path";
  label: string;
  value: string;
  note: string;
}

export interface Project {
  id: string;
  name: string;
  objective: string;
  revision: number;
  created_at: string;
  updated_at: string;
  created_by: string;
}

/** Lightweight node row as returned by GET /projects/{p}/graph (no details_md). */
export interface GraphNode {
  id: string;
  parent_id: string | null;
  order_index: number;
  kind: NodeKind;
  title: string;
  summary: string;
  status: NodeStatus;
  tags: string[];
  evidence_count: number;
  child_count: number;
  relation_count: number;
  /** only ever true when the graph was fetched with include_archived (B04) */
  archived?: boolean;
  created_at: string;
  updated_at: string;
  created_by: string;
}

export interface GraphResponse {
  project_revision: number;
  project: Project;
  nodes: GraphNode[];
}

/** Full node as returned by GET /projects/{p}/nodes/{n}. */
export interface NodeFull {
  id: string;
  parent_id: string | null;
  order_index: number;
  kind: NodeKind;
  title: string;
  summary: string;
  status: NodeStatus;
  rationale: string;
  finding: string;
  decision: string;
  scope: string;
  details_md: string;
  tags: string[];
  evidence: EvidenceItem[];
  archived: boolean;
  created_at: string;
  updated_at: string;
  created_by: string;
  updated_by: string;
  project_revision: number;
  path: { id: string; title: string; kind: NodeKind | null; status: NodeStatus | null }[];
  relation_count: number;
  /** direct non-archived child count (0 ⇒ leaf, archive-eligible) */
  child_count: number;
}

export interface RelationOther {
  id: string;
  title: string;
  kind: NodeKind | null;
  status: NodeStatus | null;
  archived: boolean;
  path: { id: string; title: string; kind: NodeKind | null; status: NodeStatus | null }[];
}

export interface RelationItem {
  id: string;
  kind: RelationKind;
  reason: string;
  archived: boolean;
  direction: "outgoing" | "incoming";
  other: RelationOther;
  created_at: string;
  updated_by: string;
}

export interface Paged<T> {
  items: T[];
  next_cursor: string | null;
  has_more: boolean;
}

export interface SearchItem {
  id: string;
  title: string;
  kind: NodeKind;
  status: NodeStatus;
  summary: string;
  matched_fields: string[];
  path: { id: string; title: string; kind: NodeKind | null; status: NodeStatus | null }[];
  updated_at: string;
}

export interface CommitItem {
  id: string;
  revision: number;
  base_revision: number;
  request_id: string;
  actor: string;
  client_label: string | null;
  summary: string;
  created_at: string;
  node_ids: string[];
}

export interface ChangeEntry {
  type: string;
  object_id: string;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  changed?: Record<string, { before: unknown; after: unknown }>;
  [k: string]: unknown;
}

export interface CommitDetail extends CommitItem {
  operations: unknown[];
  changes: ChangeEntry[];
  response: Record<string, unknown>;
  request_hash: string;
}

export interface ExportDoc {
  schema_version: number;
  exported_at: string;
  project_revision: number;
  project: Project & { revision: number };
  nodes: (NodeFull & { project_id: string })[];
  relations: (RelationItem & { id: string })[];
  commits: CommitDetail[];
  counts: Record<string, number>;
}

export interface ApiErrorBody {
  error: { code: string; message: string; details: Record<string, unknown> };
}

export class ApiError extends Error {
  status: number;
  code: string;
  details: Record<string, unknown>;
  constructor(status: number, code: string, message: string, details: Record<string, unknown>) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
  get currentRevision(): number | null {
    const v = this.details["current_revision"];
    return typeof v === "number" ? v : null;
  }
}

/** One op in a commit batch; the backend rejects unknown fields (T19). */
export type CommitOp = Record<string, unknown> & { op: string };

export interface CommitRequest {
  request_id: string;
  expected_revision: number;
  summary: string;
  client_label?: string;
  operations: CommitOp[];
}

export interface CommitResponse {
  commit_id: string;
  request_id: string;
  revision: number;
  base_revision: number;
  created_node_ids: string[];
  updated_node_ids: string[];
  moved_node_ids: string[];
  archived_node_ids: string[];
  restored_node_ids: string[];
  created_relation_ids: string[];
  updated_relation_ids: string[];
  archived_relation_ids: string[];
  restored_relation_ids: string[];
  warnings: string[];
  already_committed: boolean;
}