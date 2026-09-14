/** A5: resizable, collapsible wrapper around SidePanel (方案 §4).
 *
 *  Details that are load-bearing:
 *  - The panel is hidden with CSS (width 0 + overflow hidden), never unmounted:
 *    DetailTab keeps its local editing state while hidden (隐藏≠取消编辑).
 *  - Width/collapse live in `rm.prefs.app` (A1). A null stored preference means
 *    "no explicit choice yet" → first visit starts collapsed without a
 *    selection; once set, always respected.
 *  - Dragging only changes flex width; fitSignal/didInitialFit are untouched so
 *    the canvas never refits. After a drag (or expand), if the selected node is
 *    fully outside the visible canvas we surface a 「定位当前节点」 chip wired to
 *    the existing setPendingLocate path.
 *  - Below ~1000px of available width the panel switches to an overlay drawer
 *    (replaces the old 900px media query).
 *  - The leave-guard for unsaved drafts lives in Workspace; hiding the panel
 *    neither asks nor discards.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { loadAppPrefs, saveAppPrefs } from "../lib/viewPrefs";
import { useT } from "../lib/i18n";

const MIN_W = 300;
const START_W = 400;
/** Overlay-drawer threshold; off with hysteresis-free margin above it. */
const DRAWER_BELOW = 1000;
const KB_STEP = 24;

function clampWidth(w: number, avail: number): number {
  const max = Math.max(MIN_W, Math.floor(avail * 0.45));
  return Math.min(Math.max(w, MIN_W), max);
}

/** Is the node's card fully outside the canvas-wrap's visible box? */
function nodeOffscreen(wrap: HTMLElement, nodeId: string): boolean {
  const el = wrap.querySelector(`.react-flow__node[data-id="${CSS.escape(nodeId)}"]`);
  if (!el) return true; // filtered out / branch-rooted away → as good as invisible
  const r = el.getBoundingClientRect();
  const w = wrap.getBoundingClientRect();
  const pad = 2;
  return (
    r.left >= w.right - pad ||
    r.right <= w.left + pad ||
    r.top >= w.bottom - pad ||
    r.bottom <= w.top + pad
  );
}

export interface ResizablePanelProps {
  dirty: boolean;
  /** C2: a node-create draft lives only in the side panel — while a session
   *  is open the panel must be shown, even if nothing else would expand it. */
  forceOpen?: boolean;
  selectedId: string | null;
  onLocate: (nodeId: string) => void;
  children: ReactNode;
}

export default function ResizablePanel(p: ResizablePanelProps) {
  const t = useT();
  const zoneRef = useRef<HTMLDivElement>(null);
  const sideRef = useRef<HTMLDivElement>(null);

  const prefsAtMount = useRef(loadAppPrefs()).current;
  const selectedAtMount = useRef(p.selectedId).current;
  const [width, setWidth] = useState(() => Math.max(MIN_W, prefsAtMount.side.width ?? START_W));
  const [collapsed, setCollapsed] = useState(
    () => prefsAtMount.side.collapsed ?? selectedAtMount == null,
  );
  const [avail, setAvail] = useState(0);
  const [showLocate, setShowLocate] = useState(false);
  const [dragging, setDragging] = useState(false);

  // Mirror for pointer/keyboard handlers built per event (no stale closures).
  const widthRef = useRef(width);
  const collapsedRef = useRef(collapsed);
  widthRef.current = width;
  collapsedRef.current = collapsed;

  // Track the workspace's available width (the zone's parent). ResizeObserver —
  // not a window media query — so sidebar dragging and browser zoom both count.
  useEffect(() => {
    const zone = zoneRef.current;
    const host = zone?.parentElement;
    if (!zone || !host) return;
    const update = () => setAvail(host.clientWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(host);
    return () => ro.disconnect();
  }, []);

  const drawer = avail > 0 && avail < DRAWER_BELOW;

  // Re-clamp the stored width whenever the available width changes (reload on a
  // smaller window, browser zoom). Skipped in drawer mode; re-applied on exit.
  useEffect(() => {
    if (drawer || avail <= 0) return;
    setWidth((w) => {
      const c = clampWidth(w, avail);
      return c === w ? w : c;
    });
  }, [avail, drawer]);

  const commitWidth = useCallback((w: number) => {
    setWidth(w);
    widthRef.current = w;
    saveAppPrefs({ width: w });
  }, []);

  const checkLocate = useCallback(() => {
    const zone = zoneRef.current;
    if (!zone || !p.selectedId) {
      setShowLocate(false);
      return;
    }
    const wrap = zone.previousElementSibling as HTMLElement | null;
    setShowLocate(!wrap || nodeOffscreen(wrap, p.selectedId));
  }, [p.selectedId]);

  // New selection → previous chip verdict no longer applies.
  useEffect(() => {
    setShowLocate(false);
  }, [p.selectedId]);

  // Was the collapse side ever chosen explicitly (persisted pref, rail click,
  // drag) — vs. merely "no selection at mount → start collapsed"? Only an
  // explicit 收起 must survive a later node selection; the default-hidden start
  // still has to reveal the panel when the user actually picks a node,
  // otherwise selecting on the canvas looks like nothing happened.
  const explicitRef = useRef(prefsAtMount.side.collapsed != null);
  useEffect(() => {
    if (!p.selectedId || !collapsedRef.current || explicitRef.current) return;
    setCollapsed(false);
  }, [p.selectedId]);

  // Entering edit mode makes the draft dirty; if the panel is hidden, bring it
  // back so the user sees their draft (方案 §4 进编辑按钮自动展开).
  useEffect(() => {
    if (p.dirty && collapsedRef.current) setCollapsed(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.dirty]);

  // C2: same for an open create-draft session — the panel is its only editor,
  // so starting one reveals the panel immediately (a fresh empty draft is not
  // "dirty" yet, the p.dirty effect above would fire only on the first keystroke).
  useEffect(() => {
    if (p.forceOpen && collapsedRef.current) {
      explicitRef.current = true;
      collapsedRef.current = false;
      setCollapsed(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.forceOpen]);

  const toggleCollapsed = useCallback(() => {
    explicitRef.current = true;
    const nc = !collapsedRef.current;
    setCollapsed(nc);
    collapsedRef.current = nc;
    saveAppPrefs({ collapsed: nc });
    if (!nc) requestAnimationFrame(checkLocate);
  }, [checkLocate]);

  // ---- drag ---------------------------------------------------------------
  const drag = useRef<{ startX: number; startW: number } | null>(null);
  const onHandleDown = (e: React.PointerEvent) => {
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { startX: e.clientX, startW: widthRef.current };
    setDragging(true);
  };
  const onHandleMove = (e: React.PointerEvent) => {
    if (!drag.current) return;
    const next = drag.current.startW - (e.clientX - drag.current.startX);
    const w = Math.max(MIN_W, next);
    widthRef.current = w;
    setWidth(w);
    if (collapsedRef.current) {
      explicitRef.current = true;
      collapsedRef.current = false;
      setCollapsed(false);
      saveAppPrefs({ collapsed: false });
    }
  };
  const onHandleUp = (e: React.PointerEvent) => {
    if (!drag.current) return;
    drag.current = null;
    setDragging(false);
    (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    const host = zoneRef.current?.parentElement?.clientWidth ?? avail;
    commitWidth(clampWidth(widthRef.current, host));
    checkLocate();
  };

  // ---- keyboard resize ------------------------------------------------------
  const onHandleKey = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const zone = zoneRef.current;
    const host = zone?.parentElement;
    let w = widthRef.current + (e.key === "ArrowLeft" ? KB_STEP : -KB_STEP);
    if (host) w = clampWidth(w, host.clientWidth);
    commitWidth(w);
    if (collapsedRef.current) {
      explicitRef.current = true;
      collapsedRef.current = false;
      setCollapsed(false);
      saveAppPrefs({ collapsed: false });
    }
    requestAnimationFrame(checkLocate);
  };

  // Panel width for layout; chip offset follows whichever width actually shows.
  const panelW = collapsed
    ? 0
    : drawer
      ? Math.min(width, Math.max(MIN_W, (zoneRef.current?.parentElement?.clientWidth ?? avail) - 32))
      : width;

  return (
    <div ref={zoneRef} className={`side-zone${drawer ? " drawer" : ""}`} data-testid="side-zone">
      <div className="rail">
        <button
          className="rail-toggle"
          data-testid="side-rail"
          title={collapsed ? t("a5.expand.title") : t("a5.collapse.title")}
          aria-expanded={!collapsed}
          onClick={toggleCollapsed}
        >
          {collapsed ? "◂" : "▸"}
          {p.dirty && collapsed && (
            <span className="dot" aria-hidden="true" title={t("a5.rail.dirty.title")} />
          )}
        </button>
      </div>
      <div
        className="side-hnd"
        role="separator"
        aria-orientation="vertical"
        aria-label={t("a5.handle.label")}
        aria-valuenow={Math.round(width)}
        aria-valuemin={MIN_W}
        aria-valuemax={avail > 0 ? Math.max(MIN_W, Math.floor(avail * 0.45)) : undefined}
        tabIndex={0}
        data-testid="side-handle"
        onPointerDown={onHandleDown}
        onPointerMove={onHandleMove}
        onPointerUp={onHandleUp}
        onKeyDown={onHandleKey}
      />
      <div
        ref={sideRef}
        className={`side${collapsed ? " collapsed" : ""}`}
        data-testid="side-panel"
        style={
          collapsed
            ? { width: 0, minWidth: 0, overflow: "hidden", borderLeft: "none" }
            : drawer
              ? { width: panelW, minWidth: MIN_W, maxWidth: "none" }
              : { width, minWidth: MIN_W, maxWidth: avail > 0 ? Math.max(MIN_W, Math.floor(avail * 0.45)) : "none" }
        }
      >
        {p.children}
      </div>
      {showLocate && !dragging && (
        <button
          className="locate-chip"
          data-testid="locate-chip"
          style={{ right: panelW + 16 }}
          onClick={() => {
            if (p.selectedId) p.onLocate(p.selectedId);
            setShowLocate(false);
          }}
        >
          {t("a5.locate.chip")}
        </button>
      )}
    </div>
  );
}
