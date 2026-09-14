import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getLang, setLang, t } from "../i18n";
import { zh } from "../dict.zh";
import { en } from "../dict.en";

beforeEach(() => {
  const map = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => void map.set(k, String(v)),
    removeItem: (k: string) => void map.delete(k),
    clear: () => void map.clear(),
    key: () => null,
    length: 0,
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  setLang("zh"); // restore module state for other suites
});

describe("dictionary parity", () => {
  it("en implements every zh key (and keys exist nowhere else)", () => {
    const zhKeys = Object.keys(zh);
    const enKeys = Object.keys(en);
    expect(enKeys.length).toBe(zhKeys.length);
    for (const k of zhKeys) {
      expect(typeof en[k as keyof typeof zh]).toBe("string");
      expect((en as Record<string, string>)[k].length).toBeGreaterThan(0);
    }
    expect(new Set(zhKeys).size).toBe(zhKeys.length);
  });
});

describe("t()", () => {
  it("resolves zh values verbatim", () => {
    expect(t("topbar.new.route")).toBe("+ 一级路线");
  });

  it("interpolates named params", () => {
    expect(t("empty.enter.btn", { name: "锂电", rev: 3 })).toBe("进入「锂电」（v3）");
  });

  it("falls back to the key itself for unknown keys", () => {
    expect(t("__missing.key__")).toBe("__missing.key__");
  });

  it("setLang switches t() output and persists the choice", () => {
    setLang("en");
    expect(getLang()).toBe("en");
    expect(t("topbar.new.route")).toBe("+ Top-level route");
    expect(localStorage.getItem("rm.lang")).toBe("en");
    setLang("zh");
    expect(t("topbar.new.route")).toBe("+ 一级路线");
  });

  it("setLang to the current language is a no-op", () => {
    setLang("zh");
    expect(getLang()).toBe("zh");
  });
});
