/** A02/R02: three-way merge rules. The conflict set drives a blocking UI, so
 *  a false positive is as damaging as a missed conflict. */

import { describe, expect, it } from "vitest";
import { threeWayMerge } from "../merge";

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
