/** Pure three-way merge for editable records (A02/R02).

Used by every path that drops a fresh server snapshot onto a live draft:
post-commit sync, 「载入更新」 and 「载入新版并重排草稿」. Keeping it here —
pure, dependency-free — is what makes the conflict rules testable instead of
re-derived per call site. */

export interface FieldConflict<T> {
  field: keyof T & string;
  label: string;
  base: T[keyof T];
  local: T[keyof T];
  server: T[keyof T];
}

export interface MergeResult<T> {
  merged: T;
  conflicts: FieldConflict<T>[];
}

/** Fields you edited keep your value; fields you left alone take the server's.
 *
 *  A field is a CONFLICT only when both sides moved it away from the common
 *  base *to different values*. Convergent edits (both sides landed on the same
 *  value — e.g. the snapshot read right after your own commit committed) are
 *  merges, not conflicts, and must not be reported: doing so would make every
 *  successful save look like someone else had edited under you. */
export function threeWayMerge<T extends object>(
  base: T,
  local: T,
  server: T,
  labelOf: (field: keyof T & string) => string,
): MergeResult<T> {
  const conflicts: FieldConflict<T>[] = [];
  const merged = { ...server };
  for (const field of Object.keys(server) as (keyof T & string)[]) {
    const baseV = JSON.stringify(base[field]);
    const localV = JSON.stringify(local[field]);
    const serverV = JSON.stringify(server[field]);
    if (localV === baseV) continue;
    merged[field] = local[field];
    if (serverV !== baseV && serverV !== localV) {
      conflicts.push({
        field,
        label: labelOf(field),
        base: base[field],
        local: local[field],
        server: server[field],
      });
    }
  }
  return { merged, conflicts };
}
