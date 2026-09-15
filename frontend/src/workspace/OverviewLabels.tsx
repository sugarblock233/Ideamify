/** B1: overview-tier overlay (DECISIONS §14 概览层).
 *
 *  Screen-space labels drawn over the canvas while the overview tier is
 *  active — cards shrink to color+glyph blocks there, so a route name is the
 *  readable hint left on the map:
 *  - one label per visible top-level route, sorted by (depth, order) with a
 *    deterministic push-down AABB resolution (identical inputs always
 *    produce the identical label layout);
 *  - F08 固定路线导航: a screen-fixed collapsible rail listing every visible
 *    top-level route — the projected labels can all sit off-screen on a
 *    1104-node map fitted to view, and the rail is the always-visible entry
 *    point into them (click = zoom/center that route);
 *  - a floating label pinned to the selected node with a 「放大定位」 button;
 *  - hover keeps the node's full title as a native tooltip.
 *
 *  The layer subscribes to React Flow's transform store itself (zustand
 *  selector) so pans/zooms rerender only this layer, never the cards, and
 *  label size never scales with zoom — they stay screen-size by construction.
 */

import { useEffect, useRef, useState } from "react";
import { useStoreApi } from "@xyflow/react";
import { useT } from "../lib/i18n";

export interface OverviewLabelItem {
  id: string;
  /** tree depth of the item (routes are 1); the deterministic tie-break in
   *  the de-overlap order, along with `order`. */
  depth: number;
  order: number;
  /** layout px (canvas coordinates, top-left of the card) */
  x: number;
  y: number;
  title: string;
}

const LABEL_H = 18;
const LABEL_GAP = 4;

/** Transform-following shared by both label kinds (and SwimlaneHeaders, E5).
 *  The store has no selector middleware — compare the tuple across ticks
 *  ourselves. */
export function useTransform(): [number, number, number] {
  const store = useStoreApi();
  const [tf, setTf] = useState<[number, number, number]>(() => {
    const tr = store.getState().transform;
    return [tr[0], tr[1], tr[2]];
  });
  const tfRef = useRef(tf);
  useEffect(
    () =>
      store.subscribe((s) => {
        const tr = s.transform;
        if (tr[0] !== tfRef.current[0] || tr[1] !== tfRef.current[1] || tr[2] !== tfRef.current[2]) {
          tfRef.current = [tr[0], tr[1], tr[2]];
          setTf(tfRef.current);
        }
      }),
    [store],
  );
  return tf;
}

export default function OverviewLabels(p: {
  items: OverviewLabelItem[];
  selected: OverviewLabelItem | null;
  onZoomIn: (id: string) => void;
}) {
  const t = useT();
  const tf = useTransform();
  // F08: the fixed route rail starts expanded; the collapse persists for the
  // canvas mount (not a view pref — it is navigation chrome, not data).
  const [railOpen, setRailOpen] = useState(true);

  // Deterministic de-overlap: sort by (depth, order), then push any label
  // down until its box no longer overlaps a previously placed one. Same
  // inputs → same layout, always.
  const placed: { x: number; y: number; w: number; it: OverviewLabelItem }[] = [];
  for (const it of [...p.items].sort(
    (a, b) => a.depth - b.depth || a.order - b.order || a.id.localeCompare(b.id),
  )) {
    const x = tf[0] + it.x * tf[2];
    const w = Math.min(it.title.length * 12 + 20, 200);
    let y = tf[1] + it.y * tf[2] - LABEL_H - 2;
    let hit = true;
    for (let guard = 0; hit && guard < 40; guard++) {
      hit = false;
      for (const b of placed) {
        if (x < b.x + b.w && b.x < x + w && y < b.y + LABEL_H && b.y < y + LABEL_H) {
          y = b.y + LABEL_H + LABEL_GAP;
          hit = true;
        }
      }
    }
    placed.push({ x, y, w, it });
  }

  const railItems = [...p.items].sort(
    (a, b) => a.depth - b.depth || a.order - b.order || a.id.localeCompare(b.id),
  );
  return (
    <div className="ovlayer" data-testid="overview-layer">
      {p.items.length > 0 && (
        <div className="ov-rail" data-testid="route-rail">
          <button
            className="ov-rail-head"
            title={t("b1.rail.toggle.title")}
            onClick={() => setRailOpen((v) => !v)}
          >
            {railOpen ? "▾" : "▸"} {t("b1.rail.title", { n: p.items.length })}
          </button>
          {railOpen && (
            <div className="ov-rail-list">
              {railItems.map((it) => (
                <button
                  key={it.id}
                  className="ov-rail-item"
                  data-testid={`rail-route-${it.id.slice(0, 8)}`}
                  title={it.title}
                  onClick={(e) => {
                    e.stopPropagation();
                    p.onZoomIn(it.id);
                  }}
                >
                  {it.title}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      {placed.map((b) => (
        <span
          key={b.it.id}
          className="ov-label"
          title={b.it.title}
          style={{ left: b.x, top: b.y, maxWidth: b.w }}
        >
          {b.it.title}
        </span>
      ))}
      {p.selected && (
        <span
          className="ov-label ov-selected"
          data-testid="overview-selected"
          title={p.selected.title}
          style={{ left: tf[0] + p.selected.x * tf[2], top: tf[1] + p.selected.y * tf[2] }}
          onClick={(e) => {
            e.stopPropagation();
            p.onZoomIn(p.selected!.id);
          }}
        >
          <b>{t("b1.zoom.locate")}</b>
          {p.selected.title}
        </span>
      )}
    </div>
  );
}
