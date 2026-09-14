/** resolveTier: explicit locks pass through; auto hysteresis never flickers. */

import { describe, expect, it } from "vitest";
import { resolveTier, TIER_HYST, TIER_ZOOM, type DetailTier } from "../detailLevel";

describe("resolveTier explicit locks", () => {
  it("reading/compact/overview locks ignore zoom entirely", () => {
    for (const z of [0.05, 0.34, 0.5, 0.7, 2.5]) {
      expect(resolveTier("overview" as DetailTier, "reading", z)).toBe("reading");
      expect(resolveTier("reading" as DetailTier, "compact", z)).toBe("compact");
      expect(resolveTier("reading" as DetailTier, "overview", z)).toBe("overview");
    }
  });
});

describe("resolveTier auto", () => {
  it("passes through in the reading band", () => {
    expect(resolveTier("reading", "auto", TIER_ZOOM.reading)).toBe("reading");
    expect(resolveTier("reading", "auto", 1.4)).toBe("reading");
    expect(resolveTier("reading", "auto", TIER_ZOOM.reading - 0.019)).toBe("reading");
  });

  it("enters compact below the dead-band, returns only above it", () => {
    const enter = TIER_ZOOM.reading - TIER_HYST / 2;
    expect(resolveTier("reading", "auto", enter - 0.001)).toBe("compact");
    // from compact, 0.70 exactly is NOT enough to climb back (needs 0.72)
    expect(resolveTier("compact", "auto", TIER_ZOOM.reading)).toBe("compact");
    expect(resolveTier("compact", "auto", TIER_ZOOM.reading + TIER_HYST / 2 - 0.001)).toBe("compact");
    expect(resolveTier("compact", "auto", TIER_ZOOM.reading + TIER_HYST / 2 + 0.001)).toBe("reading");
  });

  it("enters overview below 0.33, returns only past 0.37", () => {
    const enter = TIER_ZOOM.overview - TIER_HYST / 2;
    expect(resolveTier("compact", "auto", enter + 0.001)).toBe("compact");
    expect(resolveTier("compact", "auto", enter - 0.001)).toBe("overview");
    expect(resolveTier("reading", "auto", 0.05)).toBe("overview");
    // overview is sticky until 0.37 …then climbs one step at a time
    expect(resolveTier("overview", "auto", TIER_ZOOM.overview)).toBe("overview");
    expect(resolveTier("overview", "auto", TIER_ZOOM.overview + TIER_HYST / 2 + 0.001)).toBe("compact");
    expect(resolveTier("compact", "auto", TIER_ZOOM.overview + TIER_HYST / 2 + 0.001)).toBe("compact");
    expect(resolveTier("compact", "auto", TIER_ZOOM.reading + TIER_HYST / 2 + 0.001)).toBe("reading");
  });

  it("riding the 0.70 band edges never oscillates", () => {
    let tier: DetailTier = "reading";
    tier = resolveTier(tier, "auto", 0.69);
    expect(tier).toBe("reading"); // 0.69 is inside the dead-band
    tier = resolveTier(tier, "auto", 0.71);
    expect(tier).toBe("reading");
    tier = resolveTier(tier, "auto", 0.679);
    expect(tier).toBe("compact"); // one clean enter
    tier = resolveTier(tier, "auto", 0.71);
    expect(tier).toBe("compact"); // dead-band again, no flip back
    tier = resolveTier(tier, "auto", 0.715);
    expect(tier).toBe("compact");
    tier = resolveTier(tier, "auto", TIER_ZOOM.reading + TIER_HYST / 2 + 0.001);
    expect(tier).toBe("reading");
    tier = resolveTier(tier, "auto", TIER_ZOOM.overview - TIER_HYST / 2 - 0.001);
    expect(tier).toBe("overview");
  });
});
