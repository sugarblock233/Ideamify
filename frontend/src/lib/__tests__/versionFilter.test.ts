import { describe, it, expect } from "vitest";
import {
  VERSION_FILTER_UNASSIGNED,
  filterNodesByVersion,
} from "../versionFilter";
import type { GraphNode } from "../types";

function node(
  id: string,
  parent_id: string | null,
  version_ids: string[],
  order_index = 0,
): GraphNode {
  return {
    id,
    parent_id,
    order_index,
    kind: "idea",
    title: id,
    summary: "",
    status: "unexplored",
    tags: [],
    evidence_count: 0,
    child_count: 0,
    relation_count: 0,
    version_ids,
    created_at: "",
    updated_at: "",
    created_by: "",
  };
}

/**   r (未分配)
 *    └ a (v1) ── a1 (v2) ─ a1x (未分配)
 *    └ b (未分配) ─ b1 (v1)
 */
function fixture() {
  return [
    node("r", null, [], 0),
    node("a", "r", ["v1"], 1),
    node("a1", "a", ["v2"], 2),
    node("a1x", "a1", [], 3),
    node("b", "r", [], 4),
    node("b1", "b", ["v1"], 5),
  ];
}

describe("filterNodesByVersion", () => {
  it("passes everything through when no version is selected", () => {
    const ns = fixture();
    expect(filterNodesByVersion(ns, null)).toBe(ns);
  });

  it("keeps matched nodes and their ancestor chain connected", () => {
    const out = filterNodesByVersion(fixture(), "v2").map((n) => n.id);
    // a1 matched; a and r are its context ancestors (§7.3 缺失祖先=上下文路径)
    expect(out).toEqual(["r", "a", "a1"]);
    // a1x is neither matched nor on a matched chain → out of view
  });

  it("honours the unassigned pseudo-view (default for migrated projects)", () => {
    const out = filterNodesByVersion(fixture(), VERSION_FILTER_UNASSIGNED).map((n) => n.id);
    expect(out).toContain("r");
    expect(out).toContain("b");
    expect(out).toContain("a1x");
    // a1 is not unassigned but appears as the context ancestor of a1x (§7.3)
    expect(out).toContain("a1");
    // b1 (v1) is neither unassigned nor context of a matched node → hidden
    expect(out).not.toContain("b1");
    // a (v1) pulls in only as context of a1x? a1x's chain is a1→a→r — a is
    // v1 too, so it shows as context, but b1 has no matched descendant.
    expect(out).toContain("a");
  });

  it("keeps shared-assignment nodes visible in both versions", () => {
    const ns = fixture();
    ns[2] = node("a1", "a", ["v1", "v2"], 2); // multi-version (多对多 §7.3)
    for (const v of ["v1", "v2"]) {
      expect(filterNodesByVersion(ns, v).map((n) => n.id)).toContain("a1");
    }
  });

  it("tolerates a dangling parent without crashing", () => {
    const ns = [node("x", "ghost", ["v1"])];
    expect(filterNodesByVersion(ns, "v1").map((n) => n.id)).toEqual(["x"]);
  });
});
