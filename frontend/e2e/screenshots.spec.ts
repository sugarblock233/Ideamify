/** README 真实截图（docs/images/）：合成演示项目 + 真实浏览器渲染。
 *
 * 每次运行独立造一个合成演示项目（名称带随机 UUID，不触碰任何既有数据），
 * 两个视口各截一张：
 *   workspace-1440x900.png  —— 主树画布 + 选中节点的跨分支关联（1440×900）
 *   detail-panel-1280x800.png —— 节点详情阅读视图（1280×800，A09 单行顶栏）
 *
 * 运行：npm run build && npx playwright test e2e/screenshots.spec.ts
 * （截图产物会被 git 跟踪；改 UI 后重跑本文件即可刷新 README 图片）。 */

import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

const TOKEN = "e2e-test-token-0001";
const BASE = "http://127.0.0.1:8021";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const IMG_DIR = path.join(HERE, "..", "..", "docs", "images");

async function api(page, method: string, path: string, body?: unknown) {
  const res = await page.request.fetch(`${BASE}${path}`, {
    method,
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    data: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  const out = { status: res.status(), json };
  if (res.status() >= 400) {
    console.log(`[api] ${method} ${path} → ${res.status()} ${text.slice(0, 600)}`);
  }
  return out;
}

interface Demo {
  pid: string;
  r1: string; r1a: string; r1b: string;
  r2: string; r2a: string; r2b: string;
  redId: string; greenId: string;
}

/** 两条一级路线，各带二级子路线 + 三级尝试（红/绿各一，证据齐全），
 *  外加一条跨分支关联（红例 ←contradicts— 绿例）。 */
async function seedDemo(page): Promise<Demo> {
  const U = () => crypto.randomUUID();
  const r1 = U(), r1a = U(), r1b = U(), r2 = U(), r2a = U(), r2b = U(), rel = U();
  const name = `DEMO 合成演示-${crypto.randomUUID().slice(0, 8)}`;
  let r = await api(page, "POST", "/api/v1/projects", {
    request_id: U(),
    name,
    objective: "合成演示项目（README 截图用，全部为虚构数据）：两条路线 + 跨分支关联。",
  });
  expect(r.status, JSON.stringify(r.json)).toBe(200);
  const pid = r.json.id;
  const rev = (await api(page, "GET", `/api/v1/projects/${pid}`)).json.revision;
  r = await api(page, "POST", `/api/v1/projects/${pid}/commits`, {
    request_id: U(),
    expected_revision: rev,
    client_label: "seed-demo",
    summary: "合成演示骨架：两条路线 × 子路线 × 红/绿尝试 + 跨分支关联",
    operations: [
      { op: "node.create", id: r1, parent_id: null, kind: "question",
        title: "主路线：主相窗口下界在哪里？", summary: "先框温度与保温时间",
        status: "in_progress", tags: ["主线"] },
      { op: "node.create", id: r1a, parent_id: r1, kind: "idea",
        title: "梯度加热替代单段", summary: "缓慢升温抑制提前成核",
        status: "in_progress" },
      { op: "node.create", id: r1b, parent_id: r1a, kind: "attempt",
        title: "140 ℃ 单段（5 h）：成核过早", summary: "3 批次中 2 批主相偏低",
        status: "not_supported",
        scope: "140 ℃ × 5 h，乙二醇/水 2:1",
        finding: "主相 41–88%（三批次），18.3° 次峰",
        decision: "放弃单段；改梯度并复查 120–130 ℃",
        evidence: [
          { kind: "inline", label: "XRD", value: "主相 41–88%，18.3° 次峰", note: "三批次原始图谱已归档" },
          { kind: "path", label: "原始数据", value: "reports/xrd/2026-08-batch-A.csv" },
        ],
        tags: ["负结果"] },
      { op: "node.create", id: r2, parent_id: null, kind: "question",
        title: "备选路线：掺杂能否移动窗口？", summary: "Mg 掺杂对照",
        status: "in_progress", tags: ["对照"] },
      { op: "node.create", id: r2a, parent_id: r2, kind: "idea",
        title: "5% Mg 掺杂梯度", summary: "固定梯度、只变掺杂", status: "in_progress" },
      { op: "node.create", id: r2b, parent_id: r2a, kind: "attempt",
        title: "5% Mg · 125 ℃ 梯度：主相 > 92%", summary: "窗口下界向低温移动",
        status: "supported",
        scope: "5% Mg，110→125 ℃/30 min，保温 2 h",
        finding: "主相 93–96%（两批次），无 18.3° 次峰",
        decision: "锁定 125 ℃ 梯度工艺窗口；下一步复刻批次",
        evidence: [
          { kind: "url", label: "图谱", value: "https://example.org/xrd/2026-09-mg5.pdf", note: "合成演示 URL" },
        ],
        tags: ["正结果"] },
      { op: "relation.create", id: rel, source_id: r1b, target_id: r2b,
        kind: "contradicts", reason: "同温区结论相反：单段成核过早 vs 梯度+掺杂主相高" },
    ],
  });
  expect(r.status, JSON.stringify(r.json)).toBe(200);
  return { pid, r1, r1a, r1b, r2, r2a, r2b, redId: r1b, greenId: r2b };
}

async function enterStudio(page, pid: string) {
  await page.goto(`/p/${pid}`);
  await expect(page.getByText("ResearchMap").first()).toBeVisible();
  await page.getByPlaceholder("访问令牌（Bearer token）").fill(TOKEN);
  await page.getByRole("button", { name: "打开" }).click();
  await expect(page.locator("select")).toHaveValue(pid);
  await expect(page.locator(".rm-card").first()).toBeVisible({ timeout: 20_000 });
}

/** 展开两级折叠，让六张卡片全部入画。 */
async function expandAll(page, d: Demo) {
  for (const t of ["梯度加热替代单段", "5% Mg 掺杂梯度"]) {
    const btn = page.locator(".rm-card", { hasText: t }).first().locator(".fold-btn");
    if ((await btn.count()) > 0) await btn.click();
  }
  await expect(page.locator(".rm-card")).toHaveCount(6, { timeout: 10_000 });
}

test("截图 1：主树画布 + 跨分支关联（1440×900）", async ({ page }) => {
  mkdirSync(IMG_DIR, { recursive: true });
  await page.setViewportSize({ width: 1440, height: 900 });
  const d = await seedDemo(page);
  await enterStudio(page, d.pid);
  await expandAll(page, d);

  // 选中绿例 → 画布上多出它的跨分支关系线（树边 6 + 关系线 1 = 7 条边）
  await page.locator(".rm-card", { hasText: "5% Mg · 125 ℃ 梯度" }).first().click();
  await expect(page.locator(".react-flow__edge")).toHaveCount(7, { timeout: 10_000 });

  // ⋯ 菜单 → 适应当前图（把六张卡 + 关系线收进视口）
  // 回归断言：第一次点击就打开（未守住的 document 关闭监听曾因开口那次
  // 点击自身把菜单立刻关掉——真实用户表现为"首点不响应"）。
  await page.locator("button.dotmenu").click();
  await expect(page.locator(".menu .pop")).toBeVisible({ timeout: 5_000 });
  await page.locator(".pop-item", { hasText: "适应当前图" }).click();
  await page.locator(".rm-card").first().waitFor({ state: "visible" });
  await page.waitForTimeout(600); // 等 fitView 动画收尾

  // 尽力：悬停关系线把标签（含义 + 原因）显示出来放进截图；失败不致命
  const strip = page.locator('path[style*="stroke-width: 14px"]').first();
  try {
    await strip.hover({ timeout: 3_000 });
    await expect(page.locator(".relabel").first()).toBeVisible({ timeout: 4_000 });
  } catch {
    // 标签未出现不影响截图（线已在画布上）
  }
  await page.waitForTimeout(300);

  await page.screenshot({ path: path.join(IMG_DIR, "workspace-1440x900.png") });
});

test("截图 2：节点详情阅读视图（1280×800，单行顶栏）", async ({ page }) => {
  mkdirSync(IMG_DIR, { recursive: true });
  await page.setViewportSize({ width: 1280, height: 800 });
  const d = await seedDemo(page);
  await enterStudio(page, d.pid);
  await expandAll(page, d);

  // 选中红例 → 右侧详情 = 阅读视图（适用条件 / 观察 / 决定 / 证据卡片）
  await page.locator(".rm-card", { hasText: "成核过早" }).first().click();
  await expect(page.locator("h2", { hasText: "成核过早" }).first()).toBeVisible(
    { timeout: 10_000 },
  );
  await expect(page.locator(".readsec-body", { hasText: "41–88%" }).first())
    .toBeVisible();
  await expect(page.locator(".evid-card").first()).toBeVisible();
  await page.waitForTimeout(400);

  await page.screenshot({ path: path.join(IMG_DIR, "detail-panel-1280x800.png") });
});