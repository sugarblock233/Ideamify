/** Information-density tiers (DECISIONS §14, 方案 §2.5).
 *
 * Three presentation tiers, driven either explicitly (density lock) or from
 * zoom (auto). Tiers never change coordinates — computeLayout does not depend
 * on them — they only change what each card draws:
 * - reading: the plain fixed-size card (SPEC 2.4, default);
 * - compact: title + status dot/glyph + fold button;
 * - overview: status color + glyph only, new/changed badges survive.
 *
 * Zoom thresholds reuse READABLE_ZOOM (0.70) so "readable" stays one constant
 * set. Auto mode hysteresis: enter a coarser tier D Hall below its threshold,
 * leave it D/2 above it — a dead-band of TIER_HYST around each threshold so
 * riding the boundary never flickers. Explicit locks pass straight through.
 */

import type { DensityMode } from "./viewPrefs";

export type DetailTier = "reading" | "compact" | "overview";

/** Zoom below which a coarser tier takes over (auto mode). */
export const TIER_ZOOM: Record<"reading" | "overview", number> = {
  reading: 0.70,
  overview: 0.35,
};

/** Full hysteresis band (±0.02 around each threshold, if entering the coarser
 *  tier below `threshold - D/2` and leaving it above `threshold + D/2`). */
export const TIER_HYST = 0.04;

/** Resolve the tier for a density mode at a zoom. `prev` matters only in auto
 *  mode (hysteresis); explicit locks ignore it entirely. */
export function resolveTier(
  prev: DetailTier,
  mode: DensityMode,
  zoom: number,
): DetailTier {
  if (mode === "reading") return "reading";
  if (mode === "compact") return "compact";
  if (mode === "overview") return "overview";

  const d = TIER_HYST / 2;
  if (prev === "overview") {
    // leaving overview requires zooming in past 0.35 + dead-band
    if (zoom < TIER_ZOOM.overview + d) return "overview";
    return "compact";
  }
  if (prev === "compact") {
    if (zoom < TIER_ZOOM.overview - d) return "overview";
    if (zoom >= TIER_ZOOM.reading + d) return "reading";
    return "compact";
  }
  // reading: coarsen below 0.70 - dead-band
  if (zoom < TIER_ZOOM.reading - d) {
    return zoom < TIER_ZOOM.overview - d ? "overview" : "compact";
  }
  return "reading";
}
