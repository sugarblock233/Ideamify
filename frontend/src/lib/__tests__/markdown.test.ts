// @vitest-environment jsdom
/** SPEC 9 (safe rendering): details_md is sanitized — scripts/images/forms
 *  are removed, only http/https/mailto URIs survive, outbound links open in a
 *  new tab without leaking the page session. */

import { describe, expect, it } from "vitest";
import { markdownToPlainText, renderMarkdown } from "../markdown";
import { appendTable } from "../../workspace/SidePanel";

describe("appendTable (D1 编辑器表格模板)", () => {
  it("appends a cols×(rows+1) GFM template with header row", () => {
    const out = appendTable("正文", 3, 2);
    expect(out.startsWith("正文\n")).toBe(true);
    const lines = out.trimEnd().split("\n");
    expect(lines[1]).toBe(""); // 与正文空一行
    expect(lines[2]).toBe("| 列1 | 列2 | 列3 |");
    expect(lines[3]).toContain("---");
    expect(lines).toHaveLength(1 + 1 + 1 + 1 + 2); // 正文 + 空行 + 表头 + 分隔 + 2 数据行
  });

  it("clamps rows/cols into 1..12", () => {
    const headerOf = (md: string) => md.trimEnd().split("\n").find((l) => l.startsWith("|"))!;
    expect(headerOf(appendTable("", 0, 1))).toBe("| 列1 |"); // cols 下限 1
    expect(headerOf(appendTable("", 99, 1)).split("|")).toHaveLength(14); // cols 上限 12 + 首尾
    expect(appendTable("", 1, 99).trimEnd().split("\n")).toHaveLength(1 + 1 + 1 + 12); // 空行+表头+分隔+12 数据行
  });
});

describe("renderMarkdown", () => {
  it("renders headings and emphasis as HTML", () => {
    const html = renderMarkdown("# 标题\n\n**粗体** 与 `代码`");
    expect(html).toContain("<h1");
    expect(html).toContain("标题");
    expect(html).toContain("粗体");
    expect(html).toContain("<code>");
  });

  it("returns '' for blank input", () => {
    expect(renderMarkdown("   ")).toBe("");
    expect(renderMarkdown("")).toBe("");
  });

  it("strips <script> entirely (T08 tag neutralization)", () => {
    const html = renderMarkdown("safe text <script>alert(1)</script> after");
    expect(html).not.toContain("<script");
    expect(html).not.toContain("alert(1)");
    expect(html).toContain("safe text");
  });

  it("forbids <iframe>, <img>, <form>, <object>", () => {
    const html = renderMarkdown(
      "<iframe src='https://evil.example'></iframe><img src='x'><form><input/></form><object data='x'></object>",
    );
    for (const tag of ["iframe", "img", "form", "input", "object"]) {
      expect(html, tag).not.toContain(`<${tag}`);
    }
  });

  it("neutralizes javascript:/data: URIs, keeps http(s)/mailto", () => {
    const bad = renderMarkdown("[x](javascript:alert(1))");
    expect(bad).not.toContain("javascript:");
    const bad2 = renderMarkdown("[x](data:text/html,<script>alert(1)</script>)");
    expect(bad2).not.toContain("data:text");
    const good = renderMarkdown("[a](https://example.com) [m](mailto:x@y.z)");
    expect(good).toContain("https://example.com");
    expect(good).toContain("mailto:x@y.z");
  });

  it("adds target=_blank rel=noopener noreferrer to outbound links (T08)", () => {
    const html = renderMarkdown("[a](https://example.com)");
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain('target="_blank"');
  });

  it("does not load external images even if <img> sneaks through text", () => {
    const html = renderMarkdown("pic: ![alt](https://cdn.example/pic.png)");
    expect(html).not.toContain("<img");
  });

  it("renders GFM tables (D1)", () => {
    const html = renderMarkdown(
      "| 指标 | 数值 |\n| --- | --- |\n| 覆盖率 | 60% |\n| 噪声 | +12% |",
    );
    expect(html).toContain("<table>");
    expect(html).toContain("<thead>");
    expect(html).toContain("<th");
    expect(html).toContain("<td");
    expect(html).toContain("覆盖率");
    // 表格内的属性仍旧白名单化：不允许 style/事件属性注入
    const evil = renderMarkdown("| x |\n| --- |\n| <b onmouseover=alert(1)>y</b> |");
    expect(evil).not.toContain("onmouseover");
    expect(evil).toContain("<b>y</b>");
  });
});

describe("markdownToPlainText", () => {
  it("flattens code fences, inline code, links, headings", () => {
    const out = markdownToPlainText("# H\n\ntext `x` [l](http://a)\n```\nblk\n```\n");
    expect(out).toContain("H");
    expect(out).toContain("text x l (http://a)");
    expect(out).toContain("blk");
    expect(out).not.toContain("`");
  });
});