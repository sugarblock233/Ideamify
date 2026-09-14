/** A02/R02: three-way merge rules. The conflict set drives a blocking UI, so
 *  a false positive is as damaging as a missed conflict. */

import { describe, expect, it } from "vitest";
import { preserveUndecided, threeWayMerge } from "../merge";

interface Rec {
  title: string;
  summary: string;
  tags: string[];
}
const L = (f: keyof Rec & string) => ({ title: "标题", summary: "摘要", tags: "标签" })[f];
const rec = (title: string, summary: string, tags: string[] = []): Rec => ({ title, summary, tags });

describe("threeWayMerge", () => {
  it("takes the server's value for fields you did not touch", () => {
    const r = threeWayMerge(rec("A", "s0"), rec("A", "s0"), rec("B", "s1"), L);
    expect(r.merged).toEqual(rec("B", "s1"));
    expect(r.conflicts).toEqual([]);
  });

  it("keeps your value for fields only you changed", () => {
    const r = threeWayMerge(rec("A", "s0"), rec("A", "mine"), rec("B", "s0"), L);
    expect(r.merged).toEqual(rec("B", "mine"));
    expect(r.conflicts).toEqual([]);
  });

  it("reports a same-field divergence with all three versions", () => {
    const r = threeWayMerge(rec("A", "base"), rec("A", "mine"), rec("A", "theirs"), L);
    // your value is what stays in the editor until you choose
    expect(r.merged.summary).toBe("mine");
    expect(r.conflicts).toEqual([
      { field: "summary", label: "摘要", base: "base", local: "mine", server: "theirs" },
    ]);
  });

  it("does NOT report a convergent edit as a conflict", () => {
    // the snapshot read right after your own commit landed: server == local
    const r = threeWayMerge(rec("A", "base"), rec("A", "same"), rec("A", "same"), L);
    expect(r.conflicts).toEqual([]);
    expect(r.merged.summary).toBe("same");
  });

  it("compares structurally, not by reference", () => {
    const same = threeWayMerge(rec("A", "s", ["x"]), rec("A", "s", ["x", "y"]), rec("A", "s", ["x", "y"]), L);
    expect(same.conflicts).toEqual([]);
    const diff = threeWayMerge(rec("A", "s", ["x"]), rec("A", "s", ["y"]), rec("A", "s", ["z"]), L);
    expect(diff.conflicts.map((c) => c.field)).toEqual(["tags"]);
  });

  it("reports every diverging field, not just the first", () => {
    const r = threeWayMerge(rec("t0", "s0"), rec("t1", "s1"), rec("t2", "s2"), L);
    expect(r.conflicts.map((c) => c.field).sort()).toEqual(["summary", "title"]);
  });
});

const conflict = (local: string, server: string) => ({
  field: "summary" as const,
  label: "摘要",
  base: "base",
  local,
  server,
});

describe("preserveUndecided", () => {
  it("keeps an undecided conflict across a refresh that no longer sees one", () => {
    // The user was shown base/local/theirs and has not answered. A later
    // refresh re-derives from the new baseline and finds nothing — dropping it
    // there would re-enable 保存 and let the draft overwrite the teammate.
    const next = preserveUndecided(
      [],
      [conflict("mine", "theirs")],
      rec("A", "mine"),
      rec("A", "theirs"),
    );
    expect(next).toEqual([conflict("mine", "theirs")]);
  });

  it("refreshes the server column when the server moved again", () => {
    const next = preserveUndecided([], [conflict("mine", "older")], rec("A", "mine"), rec("A", "newer"));
    expect(next).toEqual([conflict("mine", "newer")]);
  });

  it("drops it once the two sides converge", () => {
    const next = preserveUndecided([], [conflict("mine", "theirs")], rec("A", "same"), rec("A", "same"));
    expect(next).toEqual([]);
  });

  it("does not resurrect a conflict the user already answered", () => {
    // «采用服务器» removed it from the undecided set, and the draft now equals
    // the server: nothing left to decide.
    const next = preserveUndecided([], [], rec("A", "theirs"), rec("A", "theirs"));
    expect(next).toEqual([]);
  });

  it("does not lose a freshly detected conflict to an older undecided one", () => {
    const fresh = [conflict("mine", "theirs2")];
    const next = preserveUndecided(fresh, [conflict("mine", "theirs")], rec("A", "mine"), rec("A", "theirs2"));
    expect(next).toEqual(fresh);
  });
});
