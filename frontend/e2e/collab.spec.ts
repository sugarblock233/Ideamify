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
import { api, enterStudio, OTHER_TOKEN, seedDeepTree, TOKEN } from "./helpers";

test("AI updates remain refreshable after reading another node", async ({ page }) => {
  const s = await seedDeepTree(page);
  await enterStudio(page, s.pid);
  await expect(page.locator(".rm-card")).toHaveCount(2);
  const revision = (await api(page, "GET", `/api/v1/projects/${s.pid}`)).json.revision;
  const changed = await api(page, "POST", `/api/v1/projects/${s.pid}/commits`, {
    request_id: crypto.randomUUID(), expected_revision: revision,
    summary: "Update a route from the AI session",
    operations: [{ op: "node.update", id: s.a, fields: { title: "AI updated route" } }],
  }, OTHER_TOKEN);
  expect(changed.status, JSON.stringify(changed.json)).toBe(200);
  // Read the new project revision through a different node before polling.
  await page.locator(".rm-card", { hasText: "三层B" }).click();
  await expect(page.locator("h2", { hasText: "三层B" })).toBeVisible();
  await page.getByRole("button", { name: "刷新", exact: true }).click();
  await expect(page.locator(".rm-card", { hasText: "AI updated route" })).toBeVisible();
});

test("browser reload warns before discarding a research draft", async ({ page }) => {
  const s = await seedDeepTree(page);
  await enterStudio(page, s.pid, s.a);
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  const draft = page.locator("textarea").first();
  await draft.fill("Unsaved observation from today's experiment");
  let warned = false;
  page.on("dialog", async (dialog) => {
    warned = dialog.type() === "beforeunload";
    await dialog.dismiss();
  });
  await page.reload({ timeout: 3000 }).catch(() => {});
  expect(warned).toBe(true);
  await expect(draft).toHaveValue("Unsaved observation from today's experiment");
});

test("A03 首次打开：三层树只显示前两级，第三层折叠隐藏", async ({ page }) => {
  const s = await seedDeepTree(page);
  await enterStudio(page, s.pid);
  await expect(page.locator(".rm-card").first()).toBeVisible({ timeout: 20_000 });
  // 只有 A（一级）+ B（二级，带折叠按钮）；C（三级）不在画布上
  await expect(page.locator(".rm-card")).toHaveCount(2);
  // 限定在画布卡片内：裸 getByText("三层C") 会同时命中卡片、面包屑与详情标题，
  // 触发 Playwright 严格模式冲突（R04）。
  await expect(page.locator(".rm-card", { hasText: "三层C" })).toHaveCount(0);
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
  const cardC = page.locator(".rm-card", { hasText: "三层C" });
  await expect(cardC).toHaveCount(1, { timeout: 10_000 });
  await expect(cardC).toBeVisible();
  await expect(page.locator(".rm-card")).toHaveCount(3);
  await foldBtn().click();
  await expect(cardC).toHaveCount(0);
  await expect(page.locator(".rm-card")).toHaveCount(2);
});

test("A07 节点深链接：自动展开祖先链并定位选中", async ({ page }) => {
  const s = await seedDeepTree(page);
  await enterStudio(page, s.pid, s.c); // /p/{pid}?node={c}
  // 画布卡片与详情标题分开断言：裸 getByText 同时命中两者会触发严格模式冲突（R04）。
  await expect(page.locator(".rm-card", { hasText: "三层C" })).toBeVisible({ timeout: 20_000 });
  // 祖先全部展开：A、B、C 三张卡都在
  await expect(page.locator(".rm-card")).toHaveCount(3);
  // 详情面板选中 C
  await expect(page.locator("h2", { hasText: "三层C" }).first()).toBeVisible();
});

/** R01：有未保存草稿时，「退出」「新建项目」这类真正的离开动作必须先确认；
 *  取消后草稿逐字保留、人留在原地，确认后才真的离开。 */
test("A02 离开确认：退出与新建项目都必须先确认，取消后草稿原样保留", async ({ page }) => {
  const s = await seedDeepTree(page);
  await enterStudio(page, s.pid);
  await page.locator(".rm-card", { hasText: "三层A" }).first().click();
  await page.getByRole("button", { name: "编辑" }).click();
  const summaryBox = page.locator("textarea").first();
  const DRAFT = "R01-草稿：退出前必须提醒我";
  await summaryBox.fill(DRAFT);
  await expect(page.locator(".hint", { hasText: "有未保存的修改" }).first()).toBeVisible();

  // ---- 退出：取消 → 留在原地，草稿一字不变 ----
  let asked = "";
  page.once("dialog", (d) => { asked = d.message(); void d.dismiss(); });
  await page.getByRole("button", { name: "退出" }).click();
  expect(asked).toContain("有未保存的草稿");
  await expect(page.locator("select.project-sel")).toHaveValue(s.pid);
  await expect(summaryBox).toHaveValue(DRAFT);

  // ---- 新建项目：同一道闸口，取消后不弹建项目弹窗 ----
  asked = "";
  page.once("dialog", (d) => { asked = d.message(); void d.dismiss(); });
  await page.getByRole("button", { name: "+ 项目", exact: true }).click();
  expect(asked).toContain("有未保存的草稿");
  await expect(page.locator(".modal")).toHaveCount(0);
  await expect(summaryBox).toHaveValue(DRAFT);

  // ---- 退出：确认 → 真的回到令牌闸门 ----
  page.once("dialog", (d) => void d.accept());
  await page.getByRole("button", { name: "退出" }).click();
  await expect(page.getByPlaceholder("访问令牌（Bearer token）")).toBeVisible({ timeout: 10_000 });
});

/** B06/R08：AI 接入弹窗给的必须是可直接粘贴执行的命令，且 409 说明要覆盖
 *  服务端真实返回的四种 code，而不是笼统地说成"同一对象冲突"。 */
test("B06 AI 接入说明：命令可直接执行，409 四种情况说清楚", async ({ page }) => {
  const s = await seedDeepTree(page);
  await enterStudio(page, s.pid);
  await page.locator("button.dotmenu").click();
  await page.locator(".pop-item", { hasText: "AI 接入说明" }).click();
  const block = page.locator(".aiaccess-pre");
  await expect(block).toBeVisible();
  const text = (await block.innerText()).trim();

  // 没有 [--foo <占位>] 这类照抄就报错的伪语法
  expect(text).not.toMatch(/\[--\w[\w-]*\s/);
  // 命令里带的是真实项目 ID
  expect(text).toContain(`researchmap.py context ${s.pid}`);
  expect(text).toContain("--dry-run");
  // 409 的四种 code 都点名，并说明 REVISION_CONFLICT 锁的是项目版本
  for (const code of ["REVISION_CONFLICT", "IDEMPOTENCY_KEY_REUSED",
                      "DUPLICATE_RELATION", "PAGINATION_STALE"]) {
    expect(text, `409 说明缺少 ${code}`).toContain(code);
  }
  expect(text).toContain("整个项目的版本");
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

  // ---- 「载入新版并重排草稿」：同字段冲突进入三方比较，未处理前不可保存 ----
  await page.getByRole("button", { name: "载入新版并重排草稿" }).click();
  await expect(
    page.locator(".hint.err", { hasText: "已保留你的值" }).first(),
  ).toBeVisible({ timeout: 10_000 });
  await expect(summaryBox).toHaveValue(LOCAL);

  // R02：冲突字段展示 读取时 / 你的草稿 / 服务器 三份内容，而不是一行文字提示
  const row = page.locator(".conflict-field", { hasText: "摘要" });
  await expect(row).toHaveCount(1);
  await expect(row.locator(".conflict-col pre").nth(0)).toHaveText("基线摘要");
  await expect(row.locator(".conflict-col pre").nth(1)).toHaveText(LOCAL);
  await expect(row.locator(".conflict-col pre").nth(2)).toHaveText(REMOTE);
  // 未选择前保存被挡住（不能把未核对的同字段冲突当作已解决提交）
  await expect(page.getByRole("button", { name: "保存" })).toBeDisabled();

  // ---- 选择「保留我的」→ 冲突消失，可保存 ----
  await row.getByRole("button", { name: "保留我的" }).click();
  await expect(page.locator(".conflict-field")).toHaveCount(0);
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
/** B04：归档→恢复的完整浏览器往返。归档只能作用于叶子节点，而且归档后节点会
 *  从画布与搜索里消失——所以「能不能在浏览器里把它找回来」是这条链路的关键，
 *  也是本轮补验发现的缺口（恢复动作曾经只连了 props，没有入口）。 */
test("B04 归档→恢复：画布上找回已归档节点并原位恢复", async ({ page }) => {
  const s = await seedDeepTree(page);
  await enterStudio(page, s.pid);
  await expect(page.locator(".rm-card").first()).toBeVisible({ timeout: 20_000 });

  // 展开 B 让叶子 C 出现在画布上
  await page.locator(".rm-card", { hasText: "三层B" }).first().locator(".fold-btn").click();
  const cardC = page.locator(".rm-card", { hasText: "三层C" });
  await expect(cardC).toHaveCount(1, { timeout: 10_000 });
  await expect(page.locator(".rm-card")).toHaveCount(3);

  // ---- 归档 C（叶子）----
  await cardC.first().click();
  await expect(page.locator("h2", { hasText: "三层C" }).first()).toBeVisible();
  await page.getByRole("button", { name: "归档此节点（仅叶子）" }).click();
  await page.getByPlaceholder("归档原因（必填）").fill("B04：归档往返用例（合成）");
  await page.getByRole("button", { name: "确认归档" }).click();
  await expect(cardC).toHaveCount(0, { timeout: 15_000 });
  await expect(page.locator(".rm-card")).toHaveCount(2);
  expect((await api(page, "GET", `/api/v1/projects/${s.pid}/nodes/${s.c}`)).json.archived).toBe(true);

  // ---- 归档后仍选中的详情里直接给出恢复入口 ----
  await expect(page.locator(".hint", { hasText: "本节点已归档" })).toBeVisible();

  // ---- 切到别的节点，再靠「⋯ → 显示已归档节点」把它找回来 ----
  await page.locator(".rm-card", { hasText: "三层A" }).first().click();
  await page.locator("button.dotmenu").click();
  await page.locator(".pop-item", { hasText: "显示已归档节点" }).click();
  await expect(page.locator("button.dotmenu")).toHaveClass(/open/);
  const archivedCard = page.locator(".rm-card.archived", { hasText: "三层C" });
  await expect(archivedCard).toHaveCount(1, { timeout: 15_000 });
  await expect(archivedCard.locator(".arch-pill")).toHaveText("已归档");
  // 隐藏后又会消失（开关的两个方向都真的改到画布）。菜单是常开的开关项，
// 点完不会自动收起，所以这里不再点 ⋯。
  await page.locator(".pop-item", { hasText: "隐藏已归档节点" }).click();
  await expect(archivedCard).toHaveCount(0, { timeout: 15_000 });

  // ---- 恢复：重新显示 → 选中 → 填写原因 → 确认 ----
  await page.locator(".pop-item", { hasText: "显示已归档节点" }).click();
  await expect(archivedCard).toHaveCount(1, { timeout: 15_000 });
  await archivedCard.first().click();
  await page.getByRole("button", { name: "恢复此节点" }).click();
  await page.getByPlaceholder("恢复原因（必填）").fill("B04：恢复往返用例（合成）");
  await page.getByRole("button", { name: "确认恢复" }).click();

  // ---- 服务器与画布同时回到未归档状态 ----
  await expect
    .poll(async () => (await api(page, "GET", `/api/v1/projects/${s.pid}/nodes/${s.c}`)).json.archived)
    .toBe(false);
  await expect(page.locator(".rm-card.archived")).toHaveCount(0, { timeout: 15_000 });
  const restored = page.locator(".rm-card", { hasText: "三层C" });
  await expect(restored).toHaveCount(1);
  await expect(restored.locator(".arch-pill")).toHaveCount(0);
  await expect(page.locator(".rm-card")).toHaveCount(3);

  // 提交历史上留下归档与恢复两条记录
  const hist = (await api(page, "GET", `/api/v1/projects/${s.pid}/commits?limit=5`)).json;
  const types = hist.items.map((c: { summary: string }) => c.summary).join("|");
  expect(types).toContain("归档节点");
  expect(types).toContain("恢复节点");
});

/** R02：提交成功后的自动刷新（`syncAll`）此前只取三方合并的 `merged`、丢掉
 *  `conflicts` 并把基线无条件前移。这条路径的后果比"少一个提示"更重：刷新后
 *  未处理的同字段冲突会被静默清空、保存按钮重新可用，用户随手保存就把队友的
 *  提交覆盖掉了——正是冲突列表要防的事。本用例走这条真实可达的路径：
 *  编辑中 → 另一位协作者提交 → 轮询发现新版本 → 「载入更新」出现三方比较 →
 *  在**未处理**冲突的情况下做一次无关的成功提交（触发 syncAll）→ 冲突必须还在。 */
test("R02 提交后的自动刷新（syncAll）不得静默清掉未处理的同字段冲突", async ({ page }) => {
  const nid = crypto.randomUUID();
  let r = await api(page, "POST", "/api/v1/projects", {
    request_id: crypto.randomUUID(),
    name: `E2E 刷新冲突-${crypto.randomUUID().slice(0, 8)}`,
    objective: "R02：syncAll 路径的三方冲突",
  });
  expect(r.status, JSON.stringify(r.json)).toBe(200);
  const pid = r.json.id;
  const rev0 = (await api(page, "GET", `/api/v1/projects/${pid}`)).json.revision;
  const BASE_ED = "基线：服务器上的原始摘要";
  const LOCAL = "LOCAL-2：我正在编辑但还没保存";
  const REMOTE = "REMOTE-2：另一位协作者在我编辑期间提交的";
  r = await api(page, "POST", `/api/v1/projects/${pid}/commits`, {
    request_id: crypto.randomUUID(),
    expected_revision: rev0,
    client_label: "seed",
    summary: "e2e 刷新冲突骨架",
    operations: [
      { op: "node.create", id: nid, parent_id: null, kind: "question",
        title: "刷新冲突例：编辑期间别人也改了这个字段", summary: BASE_ED,
        status: "in_progress" },
    ],
  });
  expect(r.status, JSON.stringify(r.json)).toBe(200);

  await enterStudio(page, pid);
  await page.locator(".rm-card", { hasText: "刷新冲突例" }).first().click();
  await page.getByRole("button", { name: "编辑" }).click();
  const summaryBox = page.locator("textarea").first();
  await summaryBox.fill(LOCAL);
  await expect(page.locator(".hint", { hasText: "有未保存的修改" }).first()).toBeVisible();

  // 另一位协作者用第二个令牌改同一字段（本地草稿仍未保存）
  const rev1 = (await api(page, "GET", `/api/v1/projects/${pid}`)).json.revision;
  r = await api(page, "POST", `/api/v1/projects/${pid}/commits`, {
    request_id: crypto.randomUUID(),
    expected_revision: rev1,
    client_label: "other-researcher",
    summary: "远端：改同一字段（应触发新冲突）",
    operations: [{ op: "node.update", id: nid, fields: { summary: REMOTE } }],
  }, OTHER_TOKEN);
  expect(r.status, JSON.stringify(r.json)).toBe(200);

  // 前端靠轮询/窗口聚焦发现新版本；这里派发真实的 focus 事件触发它（不等 20s 轮询）
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await page.getByRole("button", { name: "载入更新" }).click();

  const row = page.locator(".conflict-field", { hasText: "摘要" });
  await expect(row).toHaveCount(1, { timeout: 15_000 });
  await expect(row.locator(".conflict-col pre").nth(0)).toHaveText(BASE_ED);
  await expect(row.locator(".conflict-col pre").nth(1)).toHaveText(LOCAL);
  await expect(row.locator(".conflict-col pre").nth(2)).toHaveText(REMOTE);
  await expect(page.getByRole("button", { name: "保存" })).toBeDisabled();

  // ---- 关键一步：冲突仍未处理，此时做一次与该节点无关的成功提交 ----
  // 提交成功后 commit() 会 await syncAll()，而 syncAll 会重新读取当前节点。
  // 修复前：重新合并的基线已经是服务器值 v2，冲突"看起来"不存在了 → 列表被清空、
  // 保存重新可用 → 用户按保存就静默覆盖了 REMOTE。修复后：未处理的冲突必须保留。
  await page.getByRole("button", { name: "+ 一级路线" }).click();
  const modal = page.locator(".modal").filter({ hasText: "新增节点" });
  await modal.locator("input").first().fill("刷新冲突例：无关的新路线（合成）");
  await modal.getByRole("button", { name: "创建" }).click();
  await expect(page.locator(".rm-card", { hasText: "无关的新路线" }).first())
    .toBeVisible({ timeout: 15_000 }); // 提交确实成功了（否则下面的断言会因别的原因通过）

  await expect(row).toHaveCount(1);
  await expect(row.locator(".conflict-col pre").nth(0)).toHaveText(BASE_ED);
  await expect(row.locator(".conflict-col pre").nth(1)).toHaveText(LOCAL);
  await expect(row.locator(".conflict-col pre").nth(2)).toHaveText(REMOTE);
  await expect(page.getByRole("button", { name: "保存" })).toBeDisabled();
  await expect(summaryBox).toHaveValue(LOCAL); // 草稿一字未动

  // 选择是真正生效的：选「保留我的」后冲突消失、保存可用，提交后服务器就是它
  await expect(page.getByRole("button", { name: "保存" })).toBeDisabled();
  await row.getByRole("button", { name: "保留我的" }).click();
  await expect(page.locator(".conflict-field")).toHaveCount(0);
  await expect(summaryBox).toHaveValue(LOCAL);
  await page.getByRole("button", { name: "保存" }).click();
  await expect
    .poll(async () => (await api(page, "GET", `/api/v1/projects/${pid}/nodes/${nid}`)).json.summary)
    .toBe(LOCAL);
});
