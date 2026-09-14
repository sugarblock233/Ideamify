/** P1 关键验收场景——需要**全新 scratch 数据库**（A01 的空实例流程）：
 *
 *   E2E_DB_DIR=$(mktemp -d) npx playwright test e2e/acceptance.spec.ts
 *
 * 默认每次运行创建独立临时数据库。
 *
 * A01：全新空库 → 令牌闸门 → 浏览器内创建首个项目 → 两条一级路线（第二条为
 *      红色尝试，走 A06 的必填证据闸口一次成功）→ 子节点 → 编辑并保存 →
 *      整页刷新 → 重新登录 → 内容与服务器一致。顺带覆盖 A09 搜索的操作路径。
 * A08：外部令牌提交更新 → 焦点事件触发轮询检查 → 出现"有新的记录"提示 →
 *      点「稍后」只收起提示、不载入 → 出现"待载入更新"标记 → 手动刷新真正载入。
 */

import { expect, test } from "@playwright/test";

const TOKEN = "e2e-test-token-0001";
const OTHER_TOKEN = "e2e-other-token-0001";
const BASE = `http://127.0.0.1:${process.env.E2E_PORT ?? 8021}`;

async function api(page, method: string, path: string, body?: unknown, token: string = TOKEN) {
  const res = await page.request.fetch(`${BASE}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    data: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  const out = { status: res.status(), json };
  if (res.status() >= 400) {
    console.log(`[api] ${method} ${path} → ${res.status()} ${text.slice(0, 400)}`);
  }
  return out;
}

async function enterStudio(page, pid: string) {
  await page.goto(`/p/${pid}`);
  await expect(page.getByText("ResearchMap").first()).toBeVisible();
  await page.getByPlaceholder("访问令牌（Bearer token）").fill(TOKEN);
  await page.getByRole("button", { name: "打开" }).click();
  await expect(page.locator("select")).toHaveValue(pid);
}

/** 顶级路线：TopBar「+ 一级路线」→ 弹窗（父级＝项目一级节点）。 */
async function createRoot(page, title: string, opts: {
  kind?: string;
  status?: string;
  summary?: string;
  gate?: { scope: string; finding: string; decision: string; evLabel: string; evValue: string };
}) {
  await page.getByRole("button", { name: "+ 一级路线" }).click();
  const modal = page.locator(".modal").filter({ hasText: "新增节点" });
  await expect(modal.getByRole("heading", { name: /新增节点/ })).toBeVisible();
  const kindSel = modal.locator("select").first();
  const statusSel = modal.locator("select").nth(1);
  if (opts.kind) await kindSel.selectOption(opts.kind);
  if (opts.status) await statusSel.selectOption(opts.status);

  const createBtn = modal.getByRole("button", { name: "创建" });
  const gatedFields = modal.locator(".gated-fields");
  if (opts.status && ["supported", "not_supported"].includes(opts.status)) {
    // A06：红/绿状态 → 必填字段出现，缺项时无法提交
    await expect(gatedFields).toBeVisible();
    expect(await createBtn.isDisabled()).toBe(true);
  }
  await modal.locator("input").first().fill(title); // 标题（autoFocus）
  if (opts.summary) {
    await modal.locator("textarea").first().fill(opts.summary);
  }
  if (opts.gate) {
    const t = (i: number) => gatedFields.locator("textarea").nth(i);
    await t(0).fill(opts.gate.scope);
    await t(1).fill(opts.gate.finding);
    await t(2).fill(opts.gate.decision);
    await gatedFields.getByRole("button", { name: "＋ 添加证据" }).click();
    const row = gatedFields.locator(".evid-row").first();
    await row.locator("input").first().fill(opts.gate.evLabel); // 名称
    await row.locator("input").nth(1).fill(opts.gate.evValue); // 内容
    expect(await createBtn.isDisabled()).toBe(false);
  }
  await createBtn.click();
}

test("A01 空数据库：浏览器完成 登录→建项目→两条一级路线→子节点→保存→刷新重登", async ({ page }) => {
  const gate = await api(page, "GET", "/api/v1/projects");
  if (!gate.json || gate.json.items.length > 0) {
    test.skip(true, "需要全新空数据库：E2E_DB_DIR=$(mktemp -d) npx playwright test e2e/acceptance.spec.ts");
  }

  // ---- 令牌闸门：登录空实例 ----
  await page.goto("/");
  await expect(page.getByText("ResearchMap").first()).toBeVisible();
  await page.getByPlaceholder("访问令牌（Bearer token）").fill(TOKEN);
  await page.getByRole("button", { name: "打开" }).click();

  // ---- 空状态是"能工作的屏幕"：有创建入口，不套自动 seed ----
  await expect(page.getByText("还没有可用的项目").first()).toBeVisible();
  // 项目 id 由服务器生成（API 不接受客户端 id）
  const pname = `A01 首个项目-${crypto.randomUUID().slice(0, 8)}`;
  await page.getByPlaceholder("如：富锂锰基正极的循环衰减机制").fill(pname);
  await page.getByPlaceholder("你要回答什么问题？").fill("A01：全新数据库首次浏览器创建（合成数据）");
  await page.getByRole("button", { name: "创建项目" }).click();
  // 进入工作室后从顶栏读取服务器生成的项目 id
  await page.getByRole("button", { name: "+ 一级路线" }).waitFor({ timeout: 15_000 });
  const pid = await page.locator(".project-sel").inputValue();
  expect(pid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);

  // ---- 两条一级路线：第一条普通，第二条红色尝试（A06 闸口一次成功）----
  await createRoot(page, "A01 一级路线甲", {
    kind: "question",
    summary: "第一条路线（问题）",
  });
  await expect(page.locator(".rm-card")).toHaveCount(1);
  await createRoot(page, "A01 一级路线乙（红）", {
    kind: "attempt",
    status: "not_supported",
    summary: "红色尝试：证据齐全的一次成功创建",
    gate: {
      scope: "140℃/5h 乙二醇体系（合成示例）",
      finding: "主相偏低，两次重复一致（合成示例数值）",
      decision: "放弃单段工艺，改梯度（合成示例决定）",
      evLabel: "XRD 摘要",
      evValue: "主相 41–88%，18.3° 次峰（合成演示数据）",
    },
  });
  await expect(page.locator(".rm-card")).toHaveCount(2);

  // 服务器侧核对：红色节点确实带证据（后端门槛没被绕过；graph 给计数，节点详情给全量）
  const g1 = (await api(page, "GET", `/api/v1/projects/${pid}/graph`)).json;
  const red = g1.nodes.find((n: any) => n.title.startsWith("A01 一级路线乙"));
  expect(red.status).toBe("not_supported");
  expect(red.evidence_count).toBe(1);
  const redFull = (await api(page, "GET", `/api/v1/projects/${pid}/nodes/${red.id}`)).json;
  expect(redFull.evidence).toHaveLength(1);

  // The first-use flow exposes child creation without requiring a right click.
  await page.locator(".rm-card", { hasText: "A01 一级路线甲" }).first().click();
  await page.getByRole("button", { name: "+ 子节点", exact: true }).click();
  const modal = page.locator(".modal").filter({ hasText: "新增节点" });
  await expect(modal).toBeVisible();
  await modal.locator("input").first().fill("A01 子节点：梯度加热");
  await modal.locator("textarea").first().fill("受甲启发的具体想法（合成）");
  await modal.getByRole("button", { name: "创建" }).click();
  await expect(page.locator(".rm-card")).toHaveCount(3);

  // ---- 保存：选中子节点 → 编辑摘要 → 保存 → 收起 ----
  await page.locator(".rm-card", { hasText: "A01 子节点" }).first().click();
  await expect(page.locator("h2", { hasText: "A01 子节点" }).first()).toBeVisible();
  await page.getByRole("button", { name: "编辑" }).click();
  const summaryBox = page.locator("textarea").first();
  await summaryBox.fill("A01 已保存摘要：梯度 30 min/步（合成）");
  await expect(page.locator(".hint", { hasText: "有未保存的修改" }).first()).toBeVisible();
  await page.getByRole("button", { name: "保存" }).click();
  await expect(page.getByRole("button", { name: "保存" })).toBeDisabled({ timeout: 10_000 });
  await page.getByRole("button", { name: "收起编辑" }).click();
  await expect(
    page.locator(".readsec-body", { hasText: "A01 已保存摘要" }).first(),
  ).toBeVisible();

  // ---- A09：顶栏搜索可看清、可操作（长标题下搜索框不被挤没）----
  const searchBox = page.getByPlaceholder("搜索标题/摘要/标签/观察/结论（中文子串可用）");
  await expect(searchBox).toBeVisible();
  await searchBox.fill("一级路线乙");
  await expect(page.locator(".pop-item b", { hasText: "A01 一级路线乙" }).first()).toBeVisible({
    timeout: 10_000,
  });
  await page.locator(".pop-item", { hasText: "A01 一级路线乙" }).first().click();
  await expect(page.locator("h2", { hasText: "A01 一级路线乙" }).first()).toBeVisible();

  // ---- 整页刷新 → 重新登录 → 内容与服务器一致 ----
  await page.reload();
  await expect(page.getByText("ResearchMap").first()).toBeVisible();
  await page.getByPlaceholder("访问令牌（Bearer token）").fill(TOKEN);
  await page.getByRole("button", { name: "打开" }).click();
  await expect(page.locator(".project-sel")).toHaveValue(pid, { timeout: 15_000 });
  await expect(page.locator(".rm-card")).toHaveCount(3, { timeout: 20_000 });
  const g2 = (await api(page, "GET", `/api/v1/projects/${pid}/graph`)).json;
  expect(g2.nodes).toHaveLength(3);
  const child = g2.nodes.find((n: any) => n.title.startsWith("A01 子节点"));
  expect(child.summary).toBe("A01 已保存摘要：梯度 30 min/步（合成）");
});

test("A08 外部更新：轮询只提示 → 稍后不载入 → 待载入标记 → 手动刷新才载入", async ({ page }) => {
  const nid = crypto.randomUUID();
  let r = await api(page, "POST", "/api/v1/projects", {
    request_id: crypto.randomUUID(),
    name: `A08 更新-${crypto.randomUUID().slice(0, 8)}`,
    objective: "A08：稍后/手动刷新的语义分离",
  });
  expect(r.status, JSON.stringify(r.json)).toBe(200);
  const pid = r.json.id; // 项目 id 由服务器生成
  const rev0 = (await api(page, "GET", `/api/v1/projects/${pid}`)).json.revision;
  r = await api(page, "POST", `/api/v1/projects/${pid}/commits`, {
    request_id: crypto.randomUUID(),
    expected_revision: rev0,
    client_label: "seed",
    summary: "A08 骨架",
    operations: [
      { op: "node.create", id: nid, parent_id: null, kind: "question",
        title: "A08 观察节点", summary: "A08 旧摘要（载入前必须仍可见）",
        status: "in_progress" },
    ],
  });
  expect(r.status).toBe(200);
  await enterStudio(page, pid);
  await page.locator(".rm-card", { hasText: "A08 观察节点" }).first().click();
  await expect(
    page.locator(".readsec-body", { hasText: "A08 旧摘要" }).first(),
  ).toBeVisible({ timeout: 10_000 });

  // ---- 另一令牌先改了同一节点 ----
  r = await api(page, "POST", `/api/v1/projects/${pid}/commits`, {
    request_id: crypto.randomUUID(),
    expected_revision: rev0 + 1,
    client_label: "other-actor",
    summary: "A08 外部更新",
    operations: [
      { op: "node.update", id: nid, fields: { summary: "A08 新摘要（外部提交）" } },
    ],
  }, OTHER_TOKEN);
  expect(r.status).toBe(200);

  // ---- 焦点事件触发一次轮询检查（20s 定时器不等）：只提示，不自动载入 ----
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.getByText("有新的记录").first()).toBeVisible({ timeout: 10_000 });

  // ---- 点「稍后」：提示收起，图不载入（详情仍是旧摘要），留下待载入入口 ----
  await page.getByRole("button", { name: "稍后" }).click();
  await expect(page.getByText("有新的记录")).toHaveCount(0);
  await expect(page.getByText(/待载入更新/).first()).toBeVisible();
  await expect(
    page.locator(".readsec-body", { hasText: "A08 旧摘要" }).first(),
  ).toBeVisible();
  await expect(page.getByText("A08 新摘要")).toHaveCount(0);

  // ---- 手动刷新：比较服务器版本并真正载入 ----
  await page.getByRole("button", { name: "刷新" }).click();
  await expect(
    page.locator(".readsec-body", { hasText: "A08 新摘要" }).first(),
  ).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText(/待载入更新/)).toHaveCount(0);
});