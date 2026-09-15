/** C3/C4 画布草稿会话（SPEC §10 / DECISIONS §17）：
 *
 *  - 打开草稿不产生任何请求（request_id 定死在草稿状态内），保存一次恰好
 *    产生一条提交与新卡片；
 *  - 取消不落库（画布卡与侧栏两条取消路径）；
 *  - IME 组合中的 Enter 不误提交（keyCode 229 / composing 守卫）；
 *  - 横→纵→大纲来回切换草稿会话存活（侧栏表单与画布卡/大纲虚线行同源）；
 *  - 409（他人先提交）后草稿保留、重存成功；断网保存失败草稿保留、恢复后
 *    重存成功；
 *  - F03：保存成功但回执丢失（合成 503）→ 重试重放冻结的完整请求体收束；
 *    冻结期的新编辑作为后续 node.update 提交；
 *  - 编辑草稿的节点卡片带 未保存 徽标（§10.2）。
 *
 *  注意：空图不渲染虚拟根卡（layout 在 0 节点时为空），画布草稿卡也无处安
 *  放（draftPlacement 返回 null，编辑走侧栏）——涉及画布卡的用例先播种一级
 *  节点。
 */

import { expect, test, type Page } from "@playwright/test";
import { api, enterStudio } from "./helpers";

async function makeProject(page: Page) {
  const r = await api(page, "POST", "/api/v1/projects", {
    request_id: crypto.randomUUID(),
    name: `E2E 草稿-${crypto.randomUUID().slice(0, 8)}`,
    objective: "C3：画布草稿会话",
  });
  expect(r.status, JSON.stringify(r.json)).toBe(200);
  const pid = r.json.id as string;
  const rev = (await api(page, "GET", `/api/v1/projects/${pid}`)).json.revision as number;
  return { pid, rev };
}

async function seedRoute(page: Page, pid: string, rev: number, title: string) {
  const r = await api(page, "POST", `/api/v1/projects/${pid}/commits`, {
    request_id: crypto.randomUUID(),
    expected_revision: rev,
    client_label: "seed",
    summary: "e2e 草稿宿主",
    operations: [
      { op: "node.create", id: crypto.randomUUID(), parent_id: null, kind: "question",
        title, summary: "占位", status: "in_progress" },
    ],
  });
  expect(r.status, JSON.stringify(r.json)).toBe(200);
  return r.json.revision as number;
}

/** 点开 + 一级路线，返回侧栏草稿表单（弹窗已退役）。 */
async function openRootDraft(page: Page) {
  await page.getByRole("button", { name: "+ 一级路线" }).click();
  const panel = page.locator(".side");
  await expect(panel.getByRole("heading", { name: /新增节点/ })).toBeVisible();
  return panel;
}

const draftTitle = (page: Page) => page.locator(".rm-draft textarea.draft-title");

test("保存一次成卡：未点创建前零请求，保存后恰好一条提交", async ({ page }) => {
  const { pid, rev } = await makeProject(page);
  await seedRoute(page, pid, rev, "既有一级路线");
  let commitPosts = 0;
  page.on("request", (req) => {
    if (req.method() === "POST" && req.url().includes("/commits")) commitPosts++;
  });
  await enterStudio(page, pid);
  await page.waitForSelector(".rm-card");

  const panel = await openRootDraft(page);
  const form = panel.locator(".editform");
  await form.locator("input").first().fill("草稿路线：先有思路再上图");
  await form.locator("textarea").first().fill("边写边想（草稿测试）");

  // 关键断言：草稿编辑全程没有主动发出提交
  expect(commitPosts).toBe(0);

  await panel.getByRole("button", { name: "创建" }).click();
  await expect(page.locator(".rm-card", { hasText: "草稿路线" })).toHaveCount(1, { timeout: 15_000 });
  expect(commitPosts).toBe(1); // request_id 幂等：一次保存 = 一条提交

  const commits = (await api(page, "GET", `/api/v1/projects/${pid}/commits`)).json;
  expect(commits.items).toHaveLength(2); // 播种 1 + 本草稿 1
  const created = commits.items.find((c: any) => c.summary.includes("草稿路线"));
  const detail = (await api(page, "GET", `/api/v1/projects/${pid}/commits/${created.id}`)).json;
  expect(detail.operations[0].title).toBe("草稿路线：先有思路再上图");
});

test("取消不落库：画布卡取消与侧栏取消都移除草稿，提交数为零", async ({ page }) => {
  const { pid, rev } = await makeProject(page);
  await seedRoute(page, pid, rev, "既有一级路线");
  await enterStudio(page, pid);
  await page.waitForSelector(".rm-card");

  // 路径一：侧栏取消
  let panel = await openRootDraft(page);
  await panel.locator(".editform input").first().fill("被侧栏取消的路线");
  await panel.getByRole("button", { name: "取消" }).click();
  await expect(page.locator(".rm-draft")).toHaveCount(0);
  await expect(page.locator(".rm-card", { hasText: "既有一级路线" })).toHaveCount(1);

  // 路径二：画布卡取消（先把虚线的草稿卡滚进视口）
  panel = await openRootDraft(page);
  await panel.locator(".editform input").first().fill("被画布取消的路线");
  await page.locator(".rm-draft").scrollIntoViewIfNeeded();
  await expect(draftTitle(page)).toHaveValue("被画布取消的路线"); // 同一草稿会话双编辑源
  await page.locator('[data-testid="draft-card-cancel"]').click();
  await expect(page.locator(".rm-draft")).toHaveCount(0);
  await expect(page.locator(".rm-card", { hasText: "既有一级路线" })).toHaveCount(1);
  await expect(panel.getByRole("heading", { name: /新增节点/ })).toHaveCount(0);

  const commits = (await api(page, "GET", `/api/v1/projects/${pid}/commits`)).json;
  expect(commits.items).toHaveLength(1); // 只剩播种那条
});

test("IME 组合中的 Enter 不误提交：blur 才是短编辑提交，保存仍要点按钮", async ({ page }) => {
  const { pid, rev } = await makeProject(page);
  await seedRoute(page, pid, rev, "既有一级路线");
  let commitPosts = 0;
  page.on("request", (req) => {
    if (req.method() === "POST" && req.url().includes("/commits")) commitPosts++;
  });
  await enterStudio(page, pid);
  await page.waitForSelector(".rm-card");

  const panel = await openRootDraft(page);
  await panel.locator(".editform input").first().fill("IME 路线");
  await page.locator(".rm-draft").scrollIntoViewIfNeeded();
  const card = page.locator(".rm-draft");
  const titleBox = draftTitle(page);
  await titleBox.click();

  // 组合开始 → System Enter 走 keyCode 229 通道：必须被守卫
  await titleBox.dispatchEvent("compositionstart", { data: "米", bubbles: true });
  await titleBox.evaluate((el) => {
    (el as HTMLTextAreaElement).value = "IME 路线：米";
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await titleBox.dispatchEvent("keydown", { key: "Enter", keyCode: 229, bubbles: true });
  await page.keyboard.press("Enter"); // composing ref 仍挂着（compositionend 未到）
  expect(commitPosts).toBe(0);

  await titleBox.dispatchEvent("compositionend", { data: "米", bubbles: true });
  // 组合结束后的 Enter：提交短编辑（blur），不保存
  await page.keyboard.press("Enter");
  expect(commitPosts).toBe(0);
  await expect(card).toHaveCount(1); // 草稿还在
  expect(await titleBox.evaluate((el) => document.activeElement !== el)).toBe(true); // 已 blur

  await card.locator('[data-testid="draft-card-save"]').click();
  await expect(page.locator(".rm-card", { hasText: "IME 路线" })).toHaveCount(1, { timeout: 15_000 });
  expect(commitPosts).toBe(1);
  const g = (await api(page, "GET", `/api/v1/projects/${pid}/graph`)).json;
  // 卡片标题在组合中被替换为候选文本：Enter 守卫的意义就是它只提交短编辑，
  // 绝不触发保存
  const saved = g.nodes.find((n: any) => n.title === "IME 路线：米");
  expect(saved).toBeDefined();
  expect(g.nodes.some((n: any) => n.title === "IME 路线")).toBe(false); // 没有双建
});

test("切换布局草稿存活：侧栏表单、画布卡、大纲只读行同源", async ({ page }) => {
  const { pid, rev } = await makeProject(page);
  await seedRoute(page, pid, rev, "既有一级路线");
  await enterStudio(page, pid);
  await page.waitForSelector(".rm-card");

  const panel = await openRootDraft(page);
  await panel.locator(".editform input").first().fill("跨布局存活的路线");
  await expect(page.locator(".rm-draft")).toHaveCount(1);

  // 大纲模式替换了整块画布，点空白关不掉菜单；vt-layout 只在弹出时可见，
  // 用它判定菜单开合，避免「点关已开的菜单」
  const openMenu = async () => {
    if (!(await page.getByTestId("vt-layout").isVisible().catch(() => false))) {
      await page.getByTestId("view-toolbar").getByRole("button").nth(2).click();
    }
    await expect(page.getByTestId("vt-layout")).toBeVisible();
  };
  // 横 → 纵：草稿卡仍在，字段值不丢
  await openMenu();
  await page.getByTestId("vt-layout-v").click();
  await page.mouse.click(10, 300);
  await expect(page.locator(".rm-draft")).toHaveCount(1);
  await expect(panel.locator(".editform input").first()).toHaveValue("跨布局存活的路线");
  await expect(panel.getByRole("heading", { name: /新增节点/ })).toBeVisible();

  // 纵 → 大纲：诚实降档为只读虚线行（编辑仍在侧栏）
  await openMenu();
  await page.getByTestId("vt-layout-outline").click();
  await expect(page.locator(".outline-row.draft")).toHaveCount(1);
  await expect(page.locator(".outline-row.draft")).toContainText("跨布局存活的路线");
  // 大纲里没有编辑器：该行不是输入框
  await expect(page.locator(".outline-row.draft textarea, .outline-row.draft input")).toHaveCount(0);
  await expect(panel.locator(".editform input").first()).toHaveValue("跨布局存活的路线");

  // 大纲 → 横：仍可继续编辑并保存
  await openMenu();
  await page.getByTestId("vt-layout-h").click();
  await page.mouse.click(10, 300);
  await expect(page.locator(".rm-draft")).toHaveCount(1);
  await panel.locator(".editform textarea").first().fill("绕一圈回来补个摘要");
  await panel.getByRole("button", { name: "创建" }).click();
  await expect(page.locator(".rm-card", { hasText: "跨布局存活的路线" })).toHaveCount(1, { timeout: 15_000 });
});

test("409 与断网：草稿保留、错误可见，恢复后重存成功", async ({ page }) => {
  const { pid, rev } = await makeProject(page);
  await seedRoute(page, pid, rev, "既有一级路线");
  await enterStudio(page, pid);
  await page.waitForSelector(".rm-card");

  // 409：打开草稿后他人抢先提交（expected_revision 落后）
  const panel = await openRootDraft(page);
  await panel.locator(".editform input").first().fill("冲突后再存的路线");
  const rev2 = (await api(page, "GET", `/api/v1/projects/${pid}`)).json.revision as number;
  const other = await api(page, "POST", `/api/v1/projects/${pid}/commits`, {
    request_id: crypto.randomUUID(),
    expected_revision: rev2,
    client_label: "e2e-racer",
    summary: "抢跑提交",
    operations: [
      { op: "node.create", id: crypto.randomUUID(), parent_id: null, kind: "question",
        title: "抢跑的一级路线", summary: "让草稿变旧", status: "in_progress" },
    ],
  });
  expect(other.status).toBe(200);

  await panel.getByRole("button", { name: "创建" }).click();
  await expect(page.locator(".hint.err", { hasText: "保存冲突" }).first()).toBeVisible({ timeout: 15_000 });
  await expect(page.locator(".rm-draft")).toHaveCount(1); // 草稿保留
  await expect(draftTitle(page)).toHaveValue("冲突后再存的路线");

  // 静默 syncAll 已把基线拉到最新：直接重存即可
  await panel.getByRole("button", { name: "创建" }).click();
  await expect(page.locator(".rm-card", { hasText: "冲突后再存的路线" })).toHaveCount(1, { timeout: 15_000 });

  // 断网：保存失败 → 草稿与输入原样保留
  const panel2 = await openRootDraft(page);
  await panel2.locator(".editform input").first().fill("断网也要保住的路线");
  await page.route("**/commits", (route) => route.abort());
  await panel2.getByRole("button", { name: "创建" }).click();
  await expect(page.locator(".rm-draft")).toHaveCount(1);
  await expect(draftTitle(page)).toHaveValue("断网也要保住的路线");
  await page.unroute("**/commits");

  await panel2.getByRole("button", { name: "创建" }).click();
  await expect(page.locator(".rm-card", { hasText: "断网也要保住的路线" })).toHaveCount(1, { timeout: 15_000 });
});

test("编辑草稿的节点卡片带 未保存 徽标（§10.2），保存后消失", async ({ page }) => {
  const { pid, rev } = await makeProject(page);
  const nid = crypto.randomUUID();
  const seeded = await api(page, "POST", `/api/v1/projects/${pid}/commits`, {
    request_id: crypto.randomUUID(),
    expected_revision: rev,
    client_label: "seed",
    summary: "徽标宿主",
    operations: [
      { op: "node.create", id: nid, parent_id: null, kind: "idea",
        title: "待编辑路线", summary: "原摘要", status: "in_progress" },
    ],
  });
  expect(seeded.status).toBe(200);
  await enterStudio(page, pid);
  await page.waitForSelector(".rm-card", { timeout: 20_000 });

  await page.locator(".rm-card", { hasText: "待编辑路线" }).first().click();
  await page.getByRole("button", { name: "编辑" }).click();
  await page.locator("textarea").first().fill("改到一半的摘要");
  await expect(page.locator(".rm-card", { hasText: "待编辑路线" }).first().locator(".unsaved-badge")).toHaveText("未保存");

  await page.getByRole("button", { name: "保存" }).click();
  await expect(page.getByRole("button", { name: "保存" })).toBeDisabled({ timeout: 10_000 });
  await expect(page.locator(".unsaved-badge")).toHaveCount(0);
});

test("F03: 保存成功但回执丢失——重放冻结请求收束，冻结期新编辑成后续修改", async ({ page }) => {
  const { pid, rev } = await makeProject(page);
  const rev2 = await seedRoute(page, pid, rev, "既有一级路线");
  await enterStudio(page, pid);
  await page.waitForSelector(".rm-card");

  const panel = await openRootDraft(page);
  const form = panel.locator(".editform");
  await form.locator("input").first().fill("回执丢失仍能收束的路线");

  // 服务器_COMMIT 成功，但浏览器收到合成 503（成功回执丢失）
  await page.route("**/commits", async (route) => {
    if (route.request().method() !== "POST") return route.continue_();
    await page.request.fetch(route.request()); // 服务器实际入库
    await route.fulfill({ status: 503, body: "synthetic lost receipt", contentType: "text/plain" });
  });
  await panel.getByRole("button", { name: "创建" }).click();
  await expect(page.locator(".rm-draft")).toHaveCount(1); // 结果不明 → 草稿保留

  // 失败后继续编辑（改摘要）——旧实现会在重试时因 payload 变化被
  // 「request_id 已被不同的提交内容使用」卡死
  await form.locator("textarea").first().fill("冻结期补写的摘要");
  await page.unroute("**/commits");

  // 重试：重放冻结的完整请求体（幂等回执），收束草稿；新编辑随后跟进
  await panel.getByRole("button", { name: "创建" }).click();
  await expect(page.locator(".rm-card", { hasText: "回执丢失仍能收束的路线" })).toHaveCount(1, { timeout: 15_000 });

  // 服务器恰好两条提交：创建 + 后续 node.update（摘要）
  const revNow = (await api(page, "GET", `/api/v1/projects/${pid}`)).json.revision as number;
  expect(revNow).toBe(rev2 + 2);
  const nid = (await api(page, "GET", `/api/v1/projects/${pid}/graph`)).json.nodes
    .find((n: { title: string }) => n.title === "回执丢失仍能收束的路线").id as string;
  const node = (await api(page, "GET", `/api/v1/projects/${pid}/nodes/${nid}`)).json;
  expect(node.summary).toBe("冻结期补写的摘要");
  await expect(page.locator(".hint.err", { hasText: "已被不同的提交内容" })).toHaveCount(0);
});
