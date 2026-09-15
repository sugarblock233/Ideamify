/** i18n (方案 §8 / DECISIONS §16)：默认语言按浏览器 locale（config 已钉
 *  zh-CN）解析；⋯ 菜单一键切换 English；界面语言切换不得影响选中节点、
 *  折叠状态与未保存草稿——用户内容（标题/摘要）永远原样。 */

import { expect, test } from "@playwright/test";

const TOKEN = "e2e-test-token-0001";
const BASE = `http://127.0.0.1:${process.env.E2E_PORT ?? 8021}`;

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

async function seedProject(page) {
  const root = crypto.randomUUID();
  const leaf = crypto.randomUUID();
  const name = `E2E i18n-${crypto.randomUUID().slice(0, 8)}`;
  let r = await api(page, "POST", "/api/v1/projects", {
    request_id: crypto.randomUUID(),
    name,
    objective: "i18n 切换不破坏状态",
  });
  expect(r.status, JSON.stringify(r.json)).toBe(200);
  const pid = r.json.id;
  const rev = (await api(page, "GET", `/api/v1/projects/${pid}`)).json.revision;
  r = await api(page, "POST", `/api/v1/projects/${pid}/commits`, {
    request_id: crypto.randomUUID(),
    expected_revision: rev,
    client_label: "seed",
    summary: "e2e i18n：一级路线 + 子节点",
    operations: [
      { op: "node.create", id: root, parent_id: null, kind: "question",
        title: "i18n 路线：语言切换是否安全？" ,
        summary: "验证中文/English 切换", status: "in_progress", tags: ["e2e"] },
      { op: "node.create", id: leaf, parent_id: root, kind: "idea",
        title: "i18n 子节点：草稿保留",
        summary: "切换语言时草稿字段不能丢", status: "unexplored", tags: [] },
    ],
  });
  expect(r.status, JSON.stringify(r.json)).toBe(200);
  return { pid, root, leaf };
}

async function enterStudio(page, pid: string) {
  await page.goto(`/p/${pid}`);
  await expect(page.getByText("ResearchMap").first()).toBeVisible();
  await page.getByPlaceholder("访问令牌（Bearer token）").fill(TOKEN);
  await page.getByRole("button", { name: "打开" }).click();
  await expect(page.locator(".project-sel")).toHaveValue(pid);
  await expect(page.locator(".rm-card").first()).toBeVisible({ timeout: 20_000 });
}

test("默认中文字符串；⋯ 菜单切换 English；选中与草稿在切换后完好；切回中文复原", async ({ page }) => {
  const s = await seedProject(page);
  await enterStudio(page, s.pid);

  // 默认（locale zh-CN）看到的是中文
  await expect(page.getByRole("button", { name: "+ 一级路线" })).toBeVisible();
  await expect(page.getByPlaceholder(/中文子串可用/)).toBeVisible();

  // 选中子节点并进入编辑，制造一个未保存草稿
  await page.locator(".rm-card", { hasText: "草稿保留" }).first().click();
  await expect(page.locator("h2", { hasText: "草稿保留" }).first()).toBeVisible();
  await page.getByRole("button", { name: "编辑" }).click();
  const summaryBox = page.locator(".side textarea").first();
  await summaryBox.fill("切换语言前的未保存草稿内容");

  // 折叠一级路线 → 画布只剩根卡片
  await page.locator(".rm-root").hover();
  const foldBtn = page.locator(".rm-card .fold-btn").first();
  await foldBtn.click();
  await expect(page.locator(".rm-card")).toHaveCount(1);

  // ⋯ 菜单 → 切换为 English
  await page.locator(".topbar .dotmenu").click();
  await page.getByTestId("lang-toggle").click();
  await expect(page.getByRole("button", { name: "+ Top-level route" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Refresh" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Exit" })).toBeVisible();
  await expect(page.getByPlaceholder(/Search titles/)).toBeVisible();

  // 选中的节点详情与未保存草稿原样保留；折叠状态也保留
  await expect(page.locator("h2", { hasText: "草稿保留" }).first()).toBeVisible();
  await expect(summaryBox).toHaveValue("切换语言前的未保存草稿内容");
  await expect(page.locator(".rm-card")).toHaveCount(1);

  // 切回中文
  await page.locator(".topbar .dotmenu").click();
  await page.getByTestId("lang-toggle").click();
  await expect(page.getByRole("button", { name: "+ 一级路线" })).toBeVisible();
  await expect(summaryBox).toHaveValue("切换语言前的未保存草稿内容");
  await expect(page.locator(".rm-card")).toHaveCount(1);
});

test("语言选择持久化：刷新重登后仍是上次选择的语言", async ({ page }) => {
  const s = await seedProject(page);
  await enterStudio(page, s.pid);
  await page.locator(".topbar .dotmenu").click();
  await page.getByTestId("lang-toggle").click();
  await expect(page.getByRole("button", { name: "Exit" })).toBeVisible();

  await page.reload();
  await expect(page.getByText("ResearchMap").first()).toBeVisible();
  await page.getByPlaceholder("Access token (Bearer token)").fill(TOKEN);
  await page.getByRole("button", { name: "Open" }).click();
  await expect(page.getByRole("button", { name: "+ Top-level route" })).toBeVisible();
});
