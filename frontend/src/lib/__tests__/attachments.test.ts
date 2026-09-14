/** splitAttachmentSegments / appendAttachmentRef (D3). */

import { describe, expect, it } from "vitest";
import { appendAttachmentRef, splitAttachmentSegments } from "../attachments";

// 合法 36 位 UUID 形状（与后端 attachment id 同构）
const U = () => "01234567-89ab-cdef-0123-456789abcdef";

describe("splitAttachmentSegments", () => {
  it("纯文本不含图片 → 单一 text 段", () => {
    const segs = splitAttachmentSegments("# 标题\n\n正文段落");
    expect(segs).toEqual([{ type: "text", md: "# 标题\n\n正文段落" }]);
  });

  it("管理附件引用抽出为 attachment 段（含 alt）", () => {
    const id = U();
    const segs = splitAttachmentSegments(`前文\n![谱图](attachment:${id})\n后文`);
    expect(segs).toEqual([
      { type: "text", md: "前文\n" },
      { type: "attachment", id, alt: "谱图" },
      { type: "text", md: "\n后文" },
    ]);
  });

  it("外链图片剥离为 external 占位段（不进 markdown 渲染）", () => {
    const segs = splitAttachmentSegments("开头 ![x](https://example.com/a.png) 结尾");
    expect(segs).toEqual([
      { type: "text", md: "开头 " },
      { type: "external", alt: "x", url: "https://example.com/a.png" },
      { type: "text", md: " 结尾" },
    ]);
  });

  it("混合排序保持原位（attachment / external / 代码块内文本不动）", () => {
    const a = U();
    const b = "ffffffff-ffff-ffff-ffff-ffffffffffff";
    const md = [
      "---",
      "",
      `![甲](attachment:${a})`,
      "",
      "```",
      `![not-an-image](attachment:${b})`, // 代码块内也按源分离——渲染段仍走净化器
      "```",
      "",
      "![乙](http://insecure.example/x.jpg)",
    ].join("\n");
    const segs = splitAttachmentSegments(md);
    expect(segs.filter((s) => s.type === "attachment").map((s) => (s as { id: string }).id)).toEqual([a, b]);
    expect(segs.filter((s) => s.type === "external")).toHaveLength(1);
    expect(segs.some((s) => s.type === "text" && s.md.includes("```"))).toBe(true);
  });

  it("空串返回空段数组 / 非 attachment: scheme 的圆括号不误切", () => {
    expect(splitAttachmentSegments("")).toEqual([]);
    const segs = splitAttachmentSegments("[链接](https://example.com) ![x](data:image/png;base64,AAAA)");
    // data: URL 不匹配 https? 外链正则，保持 text 原文（净化器兜底）
    expect(segs).toHaveLength(1);
    expect(segs[0].type).toBe("text");
  });
});

describe("appendAttachmentRef", () => {
  it("追加引用到末尾并补换行分隔", () => {
    const id = U();
    expect(appendAttachmentRef("已有正文", id, "fig 1.png"))
      .toBe(`已有正文\n![fig 1.png](attachment:${id})\n`);
  });

  it("空正文 / 末尾已有换行不再加空行", () => {
    const id = U();
    expect(appendAttachmentRef("", id, "a.png")).toBe(`![a.png](attachment:${id})\n`);
    expect(appendAttachmentRef("x\n", id, "")).toBe(`x\n![图片](attachment:${id})\n`);
  });

  it("alt 中括号剔除并截断 80", () => {
    // 90 字有效名 + [标注]：组织格式只剥中括号本身，括号内文字保留；
    // 超长部分按 80 截断（3 token + 80 alt = 83 < 80+reset，无越界风险）。
    const out = appendAttachmentRef("", U(), `${"名".repeat(90)}[标注]`);
    expect(out.includes("标注")).toBe(false);
    expect(out.split("](")[0].endsWith("名".repeat(80))).toBe(true);
  });
});
