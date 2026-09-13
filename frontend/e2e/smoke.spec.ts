/** 浏览器冒烟（SPEC 验收段）：生产形同源部署（dist/ 由 uvicorn 伺服）。
 *  流程覆盖：深链接 SPA 回退、令牌闸门（正/误）、画布渲染、选中出面板、
 *  “仅叶子归档”在 UI 的门禁（非叶 disabled + 叶走原因确认流并真的消失）。
 *  数据经 commit API 预置（节点 id 每次运行随机 UUID，避免跨用例撞 id）；
 *  端口 8021 + scratch DB（见 playwright.config.ts）。 */

import { expect, test } from "@playwright/test";

const TOKEN = "e2e-test-token-0001";
const BASE = "http://127.0.0.1:8021";

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

interface Seed { pid: string; root: string; leaf: string; name: string }

async function seedProject(page): Promise<Seed> {
  const root = crypto.randomUUID();
  const leaf = crypto.randomUUID();
  const rel = crypto.randomUUID();
  // 项目名带随机尾巴：同一 scratch DB 里会留下多个用例的项目，
  // 项目切换 <select> 里不能出现同名 option（strict mode 会炸）。
  const name = `E2E 冒烟-${crypto.randomUUID().slice(0, 8)}`;
  let r = await api(page, "POST", "/api/v1/projects", {
    request_id: crypto.randomUUID(),
    name,
    objective: "浏览器冒烟：骨架 + 一个红色尝试（证据齐全）",
  });
  expect(r.status, JSON.stringify(r.json)).toBe(200);
  const pid = r.json.id;
  const rev = (await api(page, "GET", `/api/v1/projects/${pid}`)).json.revision;
  r = await api(page, "POST", `/api/v1/projects/${pid}/commits`, {
    request_id: crypto.randomUUID(),
    expected_revision: rev,
    client_label: "seed",
    summary: "e2e 骨架：一条一级路线 + 一个红色尝试 + 一条跨节点关联",
    operations: [
      { op: "node.create", id: root, parent_id: null, kind: "question",
        title: "E2E 路线：主相可再现窗口在哪里？",
        summary: "先框温度下界，再谈生长", status: "in_progress",
        tags: ["e2e"] },
      { op: "node.create", id: leaf, parent_id: root, kind: "attempt",
        title: "E2E 红例：140 ℃ 单段（5 h）成核过早",
        summary: "3 批次中 2 批主相低于 40%",
        status: "not_supported",
        scope: "140 ℃ × 5 h，乙二醇/水 2:1",
        finding: "主相 41–88%（三批次），18.3° 次峰",
        decision: "放弃 140 ℃ 单段；改梯度并复查 120–130 ℃",
        evidence: [{ kind: "inline", label: "XRD", value: "主相差显著" }],
        tags: ["e2e", "负结果"] },
      { op: "relation.create", id: rel,
        source_id: leaf, target_id: root, kind: "supports",
        reason: "负结果直接支持窗口下界问题" },
    ],
  });
  expect(r.status, JSON.stringify(r.json)).toBe(200);
  expect(r.json.created_node_ids).toHaveLength(2);
  return { pid, root, leaf, name };
}

async function enterStudio(page, pid: string) {
  await page.goto(`/p/${pid}`); // 深路径：验证 SPA 回退到 index.html
  await expect(page.getByText("ResearchMap").first()).toBeVisible();
  await page.getByPlaceholder("访问令牌（Bearer token）").fill(TOKEN);
  await page.getByRole("button", { name: "打开" }).click();
  // 项目切换 <select> 选中值 = 本项目 id（<option> 在折叠的 select 里
  // 恒算 hidden，不能对它 toBeVisible，用 toHaveValue 断言）。
  await expect(page.locator("select")).toHaveValue(pid);
  await expect(page.locator(".rm-card", { hasText: "主相可再现窗口" }).first())
    .toBeVisible({ timeout: 20_000 });
}

test("深链接 + 令牌闸门：进入工作区且两张卡片全部渲染", async ({ page }) => {
  const s = await seedProject(page);
  await enterStudio(page, s.pid);
  await expect(page.locator(".rm-card", { hasText: "成核过早" }).first()).toBeVisible();
  await expect(page.locator(".rm-card")).toHaveCount(2);
});

test("错误令牌被闸门拒绝，页面不前进", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("ResearchMap").first()).toBeVisible();
  await page.getByPlaceholder("访问令牌（Bearer token）").fill("not-a-valid-token");
  await page.getByRole("button", { name: "打开" }).click();
  await expect(page.locator(".hint.err").first()).toBeVisible({ timeout: 10_000 });
});

test("选中节点出详情面板（标题 + 类型/状态行）", async ({ page }) => {
  const s = await seedProject(page);
  await enterStudio(page, s.pid);
  await page.locator(".rm-card", { hasText: "主相可再现窗口" }).first().click();
  await expect(page.locator("h2", { hasText: "主相可再现窗口" }).first())
    .toBeVisible({ timeout: 10_000 });
  await expect(page.getByText(/问题 · 进行中/).first()).toBeVisible();
});

test("仅叶子可归档：非叶 disabled；归档叶节点后画布少一张卡", async ({ page }) => {
  const s = await seedProject(page);
  await enterStudio(page, s.pid);

  // 非叶：按钮存在但禁用
  await page.locator(".rm-card", { hasText: "主相可再现窗口" }).first().click();
  const btnBranch = page.getByRole("button", { name: "归档此节点（仅叶子）" });
  await expect(btnBranch).toBeVisible();
  await expect(btnBranch).toBeDisabled();

  // 叶：可用，走“原因必填 → 确认”流
  await page.locator(".rm-card", { hasText: "成核过早" }).first().click();
  const btnLeaf = page.getByRole("button", { name: "归档此节点（仅叶子）" });
  await expect(btnLeaf).toBeEnabled({ timeout: 10_000 });
  await btnLeaf.click();
  await expect(page.getByRole("button", { name: "确认归档" })).toBeDisabled(); // 原因未填
  await page.getByPlaceholder("归档原因（必填）").fill("冒烟：确认归档流程");
  await page.getByRole("button", { name: "确认归档" }).click();

  await expect(page.locator(".rm-card", { hasText: "成核过早" })).toHaveCount(0,
    { timeout: 15_000 });
  await expect(page.locator(".rm-card")).toHaveCount(1);
});