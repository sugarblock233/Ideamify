/** SPEC 2.3 canvas-relation rules: overview draws none; with a selection at
 *  most 6 lines, both endpoints visible, selected relation first, rest by id. */

import { describe, expect, it } from "vitest";
import {
  isDirected,
  MAX_CANVAS_RELATION,
  relationEndpoints,
  relationLabel,
  selectCanvasRelations,
} from "../relations";
import { setLang } from "../i18n";
import type { RelationItem, RelationKind } from "../types";

// jsdom reports navigator.language = "en-US", which would resolve the initial
// language to en; these assertions pin the Chinese wording, so lock zh first.
setLang("zh");

function rel(
  id: string,
  other: string,
  direction: "outgoing" | "incoming",
  extra: Partial<RelationItem> = {},
): RelationItem {
  return {
    id,
    kind: "related",
    reason: "r",
    archived: false,
    direction,
    other: {
      id: other,
      title: other,
      kind: "idea",
      status: "unexplored",
      archived: false,
      path: [{ id: other, title: other, kind: null, status: null }],
    },
    created_at: "2026-01-01T00:00:00Z",
    updated_by: "t",
    ...extra,
  };
}

const SELF = "me";

describe("relationEndpoints", () => {
  it("outgoing: self → other; incoming: other → self", () => {
    expect(relationEndpoints(rel("r1", "b", "outgoing"), SELF)).toEqual({
      sourceId: SELF,
      targetId: "b",
    });
    expect(relationEndpoints(rel("r1", "b", "incoming"), SELF)).toEqual({
      sourceId: "b",
      targetId: SELF,
    });
  });
});

describe("isDirected", () => {
  it("'related' is undirected; the four others are directed", () => {
    expect(isDirected("related")).toBe(false);
    for (const k of ["motivates", "supports", "contradicts", "depends_on"] as RelationKind[]) {
      expect(isDirected(k)).toBe(true);
    }
  });
});

describe("selectCanvasRelations", () => {
  const vis = (ids: string[]) => new Set(ids);

  it("draws nothing when the other endpoint is not visible (folded / archived-away)", () => {
    const items = [rel("r1", "hidden", "outgoing")];
    const { shown, total } = selectCanvasRelations(items, SELF, vis([SELF]), null);
    expect(shown).toHaveLength(0);
    expect(total).toBe(1); // still counted in the sidebar total
  });

  it("skips archived relations", () => {
    const items = [rel("r1", "b", "outgoing", { archived: true })];
    const { shown, total } = selectCanvasRelations(items, SELF, vis([SELF, "b"]), null);
    expect(shown).toHaveLength(0);
    expect(total).toBe(0);
  });

  it(`caps at ${MAX_CANVAS_RELATION} lines, deterministically by id`, () => {
    const items = Array.from({ length: 10 }, (_, i) =>
      rel(`r${String(i).padStart(2, "0")}`, `t${i}`, "outgoing"),
    );
    const visible = new Set([SELF, ...items.map((r) => r.other.id)]);
    const { shown } = selectCanvasRelations(items, SELF, visible, null);
    expect(shown).toHaveLength(MAX_CANVAS_RELATION);
    expect(shown.map((s) => s.relation.id).join(",")).toBe(
      items.slice(0, MAX_CANVAS_RELATION).map((r) => r.id).join(","), // sorted by id, then capped
    );
  });

  it("shows the selected relation first even if it would sort last", () => {
    const items = [rel("r01", "a", "outgoing"), rel("r02", "b", "outgoing"), rel("r03", "c", "outgoing")];
    const visible = new Set([SELF, "a", "b", "c"]);
    const { shown } = selectCanvasRelations(items, SELF, visible, "r02");
    expect(shown[0].relation.id).toBe("r02");
    expect(shown.map((s) => s.relation.id)).toEqual(["r02", "r01", "r03"]);
  });

  it("marks directed kinds so the renderer can add arrowheads", () => {
    const items = [
      rel("r1", "a", "outgoing", { kind: "supports" }),
      rel("r2", "b", "incoming"),
    ];
    const { shown } = selectCanvasRelations(items, SELF, new Set([SELF, "a", "b"]), null);
    expect(shown.find((s) => s.relation.id === "r1")?.directed).toBe(true);
    expect(shown.find((s) => s.relation.id === "r2")?.directed).toBe(false);
  });
});

describe("relationLabel", () => {
  it("is direction-aware and Chinese for every kind", () => {
    expect(relationLabel(rel("r", "B", "outgoing", { kind: "supports" }), "A")).toBe("本节点支持 B");
    expect(relationLabel(rel("r", "B", "incoming", { kind: "supports" }), "A")).toBe("B 支持本节点");
    expect(relationLabel(rel("r", "B", "outgoing"), "A")).toBe("相关：B");
    expect(relationLabel(rel("r", "B", "incoming", { kind: "contradicts" }), "A")).toBe("B 反对本节点");
    expect(relationLabel(rel("r", "B", "outgoing", { kind: "depends_on" }), "A")).toBe("本节点依赖 B");
    expect(relationLabel(rel("r", "B", "outgoing", { kind: "motivates" }), "A")).toBe("本节点启发 B");
  });
});