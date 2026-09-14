/** A02/A03/A07 浏览器场景（生产形同源部署：uvicorn 伺服 dist/，端口 8021，scratch DB）。
 *
 * A02 共研冲突：本地有未保存草稿 → 另一位协作者（第二个令牌 e2e-other）经 API
 *      提交同字段修改 → 前端保存触发 409 REVISION_CONFLICT → 冲突指示出现、
 *      草稿完整保留（不静默覆盖）→「载入新版并重排草稿」三方合并（同字段冲突
 *      保留你的值并提示核对）→ 再保存成功且服务器值 = 本地保留值。
 * A03 首次打开默认展开：三层树首次打开只显示虚拟根 + 前两级（第三层隐藏，
 *      折叠按钮带隐藏计数）；折叠可往返。
 * A07 节点深链接：/p/{pid}?node={id} 进入页面自动展开祖先链，节点可见且选中。
 *
 * 数据经 commit API 预置（id 每次运行随机 UUID）；两个令牌见
 * playwright.config.ts webServer 的 RESEARCHMAP_TOKENS。 */

import { expect, test } from "@playwright/test";

const TOKEN = "e2e-test-token-0001";
const OTHER_TOKEN = "e2e-other-token-0001";
const BASE = "http://127.0.0.1:8021";

async function api(
  page,
  method: string,
  path: string,
  body?: unknown,
  token: string = TOKEN,
) {
  const res = await page.request.fetch(`${BASE}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
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

interface Tree3 { pid: string; a: string; b: string; c: string; name: string }

/** 建项目并一条 commit 创建 A（一级）→ B（二级）→ C（三级）。 */
async function seedDeepTree(page): Promise<Tree3> {
  const a = crypto.randomUUID();
  const b = crypto.randomUUID();
  const c = crypto.randomUUID();
  const name = `E2E 三层-${crypto.randomUUID().slice(0, 8)}`;
  let r = await api(page, "POST", "/api/v1/projects", {
    request_id: crypto.randomUUID(),
    name,
    objective: "A03/A07：三层树的首次打开与深链接定位",
  });
  expect(r.status, JSON.stringify(r.json)).toBe(200);
  const pid = r.json.id;
  const rev = (await api(page, "GET", `/api/v1/projects/${pid}`)).json.revision;
  r = await api(page, "POST", `/api/v1/projects/${pid}/commits`, {
    request_id: crypto.randomUUID(),
    expected_revision: rev,
    client_label: "seed-deep",
    summary: "e2e 三层骨架：A → B → C",
    operations: [
      { op: "node.create", id: a, parent_id: null, kind: "question",
        title: "三层A：一级路线", summary: "根问句", status: "in_progress" },
      { op: "node.create", id: b, parent_id: a, kind: "idea",
        title: "三层B：二级子路线", summary: "承上启下", status: "in_progress" },
      { op: "node.create", id: c, parent_id: b, kind: "attempt",
        title: "三层C：三级尝试", summary: "应默认隐藏", status: "unexplored" },
    ],
  });
  expect(r.status, JSON.stringify(r.json)).toBe(200);
  return { pid, a, b, c, name };
}

async function enterStudio(page, pid: string, node?: string) {
  await page.goto(`/p/${pid}${node ? `?node=${node}` : ""}`);
  await expect(page.getByText("ResearchMap").first()).toBeVisible();
  await page.getByPlaceholder("访问令牌（Bearer token）").fill(TOKEN);
  await page.getByRole("button", { name: "打开" }).click();
  await expect(page.locator("select")).toHaveValue(pid);
}

test("A03 首次打开：三层树只显示前两级，第三层折叠隐藏", async ({ page }) => {
  const s = await seedDeepTree(page);
  await enterStudio(page, s.pid);
  await expect(page.locator(".rm-card").first()).toBeVisible({ timeout: 20_000 });
  // 只有 A（一级）+ B（二级，带折叠按钮）；C（三级）不在画布上
  await expect(page.locator(".rm-card")).toHaveCount(2);
  await expect(page.getByText("三层C")).toHaveCount(0);
  // B 的折叠按钮显示隐藏子节点数 +1
  const foldBtn = page
    .locator(".rm-card", { hasText: "三层B" })
    .first()
    .locator(".fold-btn");
  await expect(foldBtn).toHaveText("+1");
});

test("A03 折叠可往返：展开第三层，再折叠收回", async ({ page }) => {
  const s = await seedDeepTree(page);
  await enterStudio(page, s.pid);
  await expect(page.locator(".rm-card").first()).toBeVisible({ timeout: 20_000 });
  const foldBtn = () =>
    page.locator(".rm-card", { hasText: "三层B" }).first().locator(".fold-btn");
  await foldBtn().click();
  await expect(page.getByText("三层C")).toBeVisible({ timeout: 10_000 });
  await expect(page.locator(".rm-card")).toHaveCount(3);
  await foldBtn().click();
  await expect(page.getByText("三层C")).toHaveCount(0);
  await expect(page.locator(".rm-card")).toHaveCount(2);
});

test("A07 节点深链接：自动展开祖先链并定位选中", async ({ page }) => {
  const s = await seedDeepTree(page);
  await enterStudio(page, s.pid, s.c); // /p/{pid}?node={c}
  await expect(page.getByText("三层C")).toBeVisible({ timeout: 20_000 });
  // 祖先全部展开：A、B、C 三张卡都在
  await expect(page.locator(".rm-card")).toHaveCount(3);
  // 详情面板选中 C
  await expect(page.locator("h2", { hasText: "三层C" }).first()).toBeVisible();
});

test("A02 同字段并发提交：409 冲突 → 保留草稿 → 重排合并 → 保存", async ({ page }) => {
  // ---- 种子：单节点 ----
  const nid = crypto.randomUUID();
  const name = `E2E 并发-${crypto.randomUUID().slice(0, 8)}`;
  let r = await api(page, "POST", "/api/v1/projects", {
    request_id: crypto.randomUUID(),
    name,
    objective: "A02：同字段并发编辑的冲突重排",
  });
  expect(r.status, JSON.stringify(r.json)).toBe(200);
  const pid = r.json.id;
  const rev0 = (await api(page, "GET", `/api/v1/projects/${pid}`)).json.revision;
  const LOCAL = "LOCAL-ED：本地未保存改动（重排后必须保留）";
  const REMOTE = "REMOTE：另一位协作者先改了同一字段";
  r = await api(page, "POST", `/api/v1/projects/${pid}/commits`, {
    request_id: crypto.randomUUID(),
    expected_revision: rev0,
    client_label: "seed",
    summary: "e2e 并发骨架：单个节点",
    operations: [
      { op: "node.create", id: nid, parent_id: null, kind: "question",
        title: "并发例：另一个团队也会改的节点", summary: "基线摘要",
        status: "in_progress" },
    ],
  });
  expect(r.status, JSON.stringify(r.json)).toBe(200);
  const revAfterSeed = (await api(page, "GET", `/api/v1/projects/${pid}`)).json.revision;
  await enterStudio(page, pid);
  await page.locator(".rm-card", { hasText: "并发例" }).first().click();
  await expect(page.locator("h2", { hasText: "并发例" }).first()).toBeVisible({ timeout: 10_000 });

  // ---- UI：进入编辑并改写摘要（本地草稿，尚未保存）----
  await page.getByRole("button", { name: "编辑" }).click();
  const summaryBox = page.locator("textarea").first();
  await expect(summaryBox).toBeVisible();
  await summaryBox.fill(LOCAL);
  await expect(
    page.locator(".hint", { hasText: "有未保存的修改" }).first(),
  ).toBeVisible();

  // ---- 另一协作者（e2e-other 令牌）经 API 先提交同字段 ----
  r = await api(page, "POST", `/api/v1/projects/${pid}/commits`, {
    request_id: crypto.randomUUID(),
    expected_revision: revAfterSeed,
    client_label: "other-actor",
    summary: "协作者改动同一字段",
    operations: [{ op: "node.update", id: nid, fields: { summary: REMOTE } }],
  }, OTHER_TOKEN);
  expect(r.status, JSON.stringify(r.json)).toBe(200);

  // ---- UI 保存 → 409：冲突指示出现，草稿未被丢弃 ----
  await page.getByRole("button", { name: "保存" }).click();
  await expect(
    page.locator(".hint.err", { hasText: "提交时发生版本冲突" }).first(),
  ).toBeVisible({ timeout: 10_000 });
  await expect(summaryBox).toHaveValue(LOCAL);

  // ---- 「载入新版并重排草稿」：同字段冲突保留本地值并提示核对 ----
  await page.getByRole("button", { name: "载入新版并重排草稿" }).click();
  await expect(
    page.locator(".hint.err", { hasText: "已保留你的值" }).first(),
  ).toBeVisible({ timeout: 10_000 });
  await expect(summaryBox).toHaveValue(LOCAL);

  // ---- 再保存：成功，读视图与服务器值 = 本地保留值 ----
  await page.getByRole("button", { name: "保存" }).click();
  await page.getByRole("button", { name: "收起编辑" }).click();
  await expect(
    page.locator(".readsec-body", { hasText: "LOCAL-ED" }).first(),
  ).toBeVisible({ timeout: 15_000 });
  const node = (await api(page, "GET", `/api/v1/projects/${pid}/nodes/${nid}`)).json;
  expect(node.summary).toBe(LOCAL);
  const revFinal = (await api(page, "GET", `/api/v1/projects/${pid}`)).json.revision;
  expect(revFinal).toBe(revAfterSeed + 2); // 远端 1 次 + 本地重排后 1 次
});