/** A03/R03：大图首屏可读性（浏览器实测，合成压测数据）。
 *
 * 第二轮验收复现的问题：默认两级展开时，d3 沿兄弟轴按子树规模铺开一级路线，
 * 包围盒纵向跨度到数千像素；旧代码试图把这个包围盒整体塞进视口，又用
 * Math.max(0.4, …) 抬住缩放，结果既没真的 fit、文字也读不了。
 *
 * 本用例用一棵"路线多、每条路线子节点也多"的合成树复现那个几何条件，然后断言
 * 首屏（无已存视图）落在可读缩放上、根节点与至少一条一级路线同时在视口内，
 * 并且平移能看到其余路线。产出的截图入 test-results/evidence/，不改动历史证据。
 *
 * 运行：npm run build && npx playwright test e2e/bigmap.spec.ts */

import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

const TOKEN = "e2e-test-token-0001";
const BASE = `http://127.0.0.1:${process.env.E2E_PORT ?? 8021}`;
const HERE = path.dirname(fileURLToPath(import.meta.url));
const EVIDENCE_DIR = path.join(HERE, "..", "test-results", "evidence");

/** 卡片宽 280px；0.7 倍是本 app 统一的"可读"缩放（Canvas.READABLE_ZOOM）。 */
const MIN_READABLE_CARD_PX = 180;

const ROUTES = 4;
const CHILDREN_PER_ROUTE = 12;
const GRANDKIDS_PER_CHILD = 4;

async function api(page, method: string, p: string, body?: unknown) {
  const res = await page.request.fetch(`${BASE}${p}`, {
    method,
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    data: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  if (res.status() >= 400) console.log(`[api] ${method} ${p} → ${res.status()} ${text.slice(0, 600)}`);
  return { status: res.status(), json };
}

/** 造一棵三层树：ROUTES 条一级路线 × CHILDREN_PER_ROUTE 个二级 × GRANDKIDS 个三级。
 *  首开默认折叠 depth≥2，所以可见 = 虚拟根 + 一级 + 二级。 */
async function seedBigTree(page): Promise<{ pid: string; routeTitles: string[] }> {
  const U = () => crypto.randomUUID();
  const r0 = await api(page, "POST", "/api/v1/projects", {
    request_id: U(),
    name: `压测 大图首屏-${U().slice(0, 8)}`,
    objective: "A03/R03：大图首屏可读性（全部为合成压测数据，不含真实研究内容）",
  });
  expect(r0.status, JSON.stringify(r0.json)).toBe(200);
  const pid = r0.json.id;

  const ops: Record<string, unknown>[] = [];
  const routeTitles: string[] = [];
  for (let i = 0; i < ROUTES; i++) {
    const rid = U();
    const rtitle = `压测路线${i + 1}`;
    routeTitles.push(rtitle);
    ops.push({ op: "node.create", id: rid, parent_id: null, kind: "question",
      title: rtitle, summary: `第 ${i + 1} 条一级路线（合成）`, status: "in_progress" });
    for (let j = 0; j < CHILDREN_PER_ROUTE; j++) {
      const cid = U();
      ops.push({ op: "node.create", id: cid, parent_id: rid, kind: "idea",
        title: `压测${i + 1}-${j + 1} 二级子路线`, summary: "二级（合成）", status: "in_progress" });
      for (let k = 0; k < GRANDKIDS_PER_CHILD; k++) {
        ops.push({ op: "node.create", id: U(), parent_id: cid, kind: "attempt",
          title: `压测${i + 1}-${j + 1}-${k + 1} 三级尝试`, summary: "三级（首开应隐藏）", status: "unexplored" });
      }
    }
  }

  // 一次 commit 最多 100 个操作；父节点必须先于子节点落库，顺序切片即可。
  for (let at = 0; at < ops.length; at += 100) {
    const rev = (await api(page, "GET", `/api/v1/projects/${pid}`)).json.revision;
    const r = await api(page, "POST", `/api/v1/projects/${pid}/commits`, {
      request_id: U(),
      expected_revision: rev,
      client_label: "seed-bigmap",
      summary: `压测骨架 ${at / 100 + 1}`,
      operations: ops.slice(at, at + 100),
    });
    expect(r.status, JSON.stringify(r.json)).toBe(200);
  }
  return { pid, routeTitles };
}

async function enterStudio(page, pid: string) {
  await page.goto(`/p/${pid}`);
  await page.getByPlaceholder("访问令牌（Bearer token）").fill(TOKEN);
  await page.getByRole("button", { name: "打开" }).click();
  await expect(page.locator(".rm-card").first()).toBeVisible({ timeout: 30_000 });
}

test("A03/R03 大图首屏：根节点与一级路线在视口内且卡片文字达到可读尺寸", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const { pid, routeTitles } = await seedBigTree(page);
  await enterStudio(page, pid);

  // 首开只展开两级：一级 + 二级可见，三级不在画布上
  const visible = await page.locator(".rm-card").count();
  expect(visible).toBe(ROUTES + ROUTES * CHILDREN_PER_ROUTE);
  await expect(page.locator(".rm-card", { hasText: "三级尝试" })).toHaveCount(0);

  const pane = page.locator(".canvas-wrap");
  const paneBox = (await pane.boundingBox())!;
  type Box = { x: number; y: number; width: number; height: number } | null;
  /** 完整可见：整张卡片都落在画布区域内，不被顶栏/侧栏裁掉。 */
  const whollyInPane = (b: Box) =>
    !!b &&
    b.x >= paneBox.x &&
    b.x + b.width <= paneBox.x + paneBox.width + 1 &&
    b.y >= paneBox.y &&
    b.y + b.height <= paneBox.y + paneBox.height + 1;
  const inPane = (b: Box) =>
    !!b &&
    b.x + b.width > paneBox.x &&
    b.x < paneBox.x + paneBox.width &&
    b.y + b.height > paneBox.y &&
    b.y < paneBox.y + paneBox.height;

  // 1) 虚拟根（项目卡）在首屏内。
  //    注：这么宽的图上，在可读缩放下根卡片与最近的一级路线无法同时**完整**入屏
  //    （本 fixture 差约 26px），相机优先保证路线完整，根卡片可能只露出一部分。
  const rootBox = await page.locator(".rm-root").first().boundingBox();
  expect(inPane(rootBox), "虚拟根应出现在首屏视口内").toBe(true);

  // 2) 至少一条一级路线**完整**可见，且渲染宽度达到可读阈值（旧实现 zoom=0.4 → 112px）
  let routesOnScreen = 0;
  let widest = 0;
  for (const t of routeTitles) {
    const b = await page.locator(".rm-card", { hasText: t }).first().boundingBox();
    if (whollyInPane(b)) {
      routesOnScreen++;
      widest = Math.max(widest, b!.width);
    }
  }
  expect(routesOnScreen, "首屏应能完整看到至少一条一级路线").toBeGreaterThanOrEqual(1);
  expect(widest, "首屏卡片渲染宽度需达到可读尺寸").toBeGreaterThanOrEqual(MIN_READABLE_CARD_PX);

  mkdirSync(EVIDENCE_DIR, { recursive: true });
  await page.screenshot({ path: path.join(EVIDENCE_DIR, "a03-firstopen-1440x900.png") });

  // 3) 其余路线靠平移就能到：连续下拖若干屏后，首屏之外的路线应当出现
  const seen = new Set<string>();
  for (const t of routeTitles) {
    const b = await page.locator(".rm-card", { hasText: t }).first().boundingBox();
    if (inPane(b)) seen.add(t);
  }
  const firstScreen = new Set(seen);
  const cx0 = paneBox.x + paneBox.width / 2;
  const cy0 = paneBox.y + paneBox.height / 2;
  for (let step = 0; step < 6 && seen.size < routeTitles.length; step++) {
    await page.mouse.move(cx0, cy0 + 300);
    await page.mouse.down();
    await page.mouse.move(cx0, cy0 - 300, { steps: 10 });
    await page.mouse.up();
    for (const t of routeTitles) {
      const b = await page.locator(".rm-card", { hasText: t }).first().boundingBox();
      if (inPane(b)) seen.add(t);
    }
  }
  expect(
    [...seen].filter((t) => !firstScreen.has(t)).length,
    "平移应能够探索到首屏之外的一级路线",
  ).toBeGreaterThanOrEqual(1);

  // 4) 「适应当前图」仍然是看全局的显式入口
  await page.locator("button.dotmenu").click();
  await page.locator(".pop-item", { hasText: "适应当前图" }).click();
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(EVIDENCE_DIR, "a03-fitview-1440x900.png") });
});

test("A03/R03 大图首屏：1280×800 同样落在可读缩放上", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const { pid, routeTitles } = await seedBigTree(page);
  await enterStudio(page, pid);

  const paneBox = (await page.locator(".canvas-wrap").boundingBox())!;
  let widest = 0;
  for (const t of routeTitles) {
    const b = await page.locator(".rm-card", { hasText: t }).first().boundingBox();
    if (
      b &&
      b.x >= paneBox.x &&
      b.x + b.width <= paneBox.x + paneBox.width + 1 &&
      b.y >= paneBox.y &&
      b.y + b.height <= paneBox.y + paneBox.height + 1
    ) {
      widest = Math.max(widest, b.width);
    }
  }
  expect(widest, "1280×800 首屏也要有完整且可读的一级路线卡片").toBeGreaterThanOrEqual(
    MIN_READABLE_CARD_PX,
  );
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  await page.screenshot({ path: path.join(EVIDENCE_DIR, "a03-firstopen-1280x800.png") });
});

test("A03/R03 分支视图：折叠→只看这一分支→展开，仍落在可读缩放上", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const { pid } = await seedBigTree(page);
  await enterStudio(page, pid);

  const route = () => page.locator(".rm-card", { hasText: "压测路线1" }).first();
  const cardCount = () => page.locator(".rm-card").count();
  const total = ROUTES + ROUTES * CHILDREN_PER_ROUTE;
  expect(await cardCount()).toBe(total);

  const ctxItem = (label: string) => page.locator(".ctx > div", { hasText: label });

  // 首屏相机锚在根卡片上，远处的路线未必在视口内；先用搜索把目标路线定位到屏幕中央，
  // 这样右键菜单一定作用在可见卡片上。
  const searchBox = page.getByPlaceholder("搜索标题/摘要/标签/观察/结论（中文子串可用）");
  await searchBox.fill("压测路线1");
  await page.locator(".pop-item", { hasText: "压测路线1" }).first().click();
  await expect(page.locator("h2", { hasText: "压测路线1" }).first()).toBeVisible();
  await expect(route()).toBeInViewport();

  // 折叠该路线 → 只剩它自己
  await route().click({ button: "right" });
  await ctxItem("折叠此分支").click();
  await expect.poll(cardCount).toBe(total - CHILDREN_PER_ROUTE);

  // 只看这一分支 → 分支视图只剩这一条路线的可见部分
  await route().click({ button: "right" });
  await ctxItem("只看这一分支").click();
  await expect(page.locator(".breadcrumbs")).toContainText("分支视图");
  await expect.poll(cardCount).toBe(1);

  // 分支视图里展开 → 1 条路线 + 它的全部二级子节点
  await route().click({ button: "right" });
  await ctxItem("展开此分支").click();
  await expect.poll(cardCount).toBe(1 + CHILDREN_PER_ROUTE);

  // 展开后的卡片仍要在可读尺寸上（分支视图与首屏共用同一套缩放心智）
  const paneBox = (await page.locator(".canvas-wrap").boundingBox())!;
  let widest = 0;
  for (let j = 0; j < CHILDREN_PER_ROUTE; j++) {
    const b = await page
      .locator(".rm-card", { hasText: `压测1-${j + 1} 二级子路线` })
      .first()
      .boundingBox();
    if (
      b &&
      b.x >= paneBox.x &&
      b.x + b.width <= paneBox.x + paneBox.width + 1 &&
      b.y >= paneBox.y &&
      b.y + b.height <= paneBox.y + paneBox.height + 1
    ) {
      widest = Math.max(widest, b.width);
    }
  }
  expect(widest, "分支视图里的卡片也要达到可读宽度").toBeGreaterThanOrEqual(MIN_READABLE_CARD_PX);

  mkdirSync(EVIDENCE_DIR, { recursive: true });
  await page.screenshot({ path: path.join(EVIDENCE_DIR, "a03-branch-expanded-1440x900.png") });

  // 面包屑回项目全景：恢复整棵树。注意"展开此分支"清掉的是共享的折叠状态，
  // 所以回到全景后这条路线（以及其他从未折叠的路线）的子节点都是可见的。
  await page.locator(".breadcrumbs a", { hasText: "项目全景" }).click();
  await expect(page.locator(".breadcrumbs")).toHaveCount(0); // 分支视图已退出
  await expect.poll(cardCount).toBe(total);
});

/* F08：大图概览的「真正可见」路线入口。
 *
 * 1104 节点级地图上拖动 Fit View，zoom 落在概览档，但四条一级路线的投影
 * 标签全部在屏幕外（top ≈ -5401…6215）——DOM 里有标签不等于用户能看到。
 * 修复 = 概览档固定出现的「路线导航」栏：每条可见一级路线一行，点击放大
 * 定位；验收即「适应全图 → 导航栏仍在屏幕内 → 点击路线 3 落在可读缩放」。 */
test("F08 大图概览：固定路线导航栏可见，点击条目放大定位到该路线", async ({ page }) => {
  const { pid, routeTitles } = await seedBigTree(page);
  await enterStudio(page, pid);

  // 全展开 + 适应全图：这次会把 244 张卡整体缩小，概览档启动
  await page.getByTestId("vt-expand-all").click();
  await page.getByRole("button", { name: "⋯" }).click();
  // 顶栏菜单项是 .pop-item（非 button role）
  await page.locator(".pop-item", { hasText: "适应当前图" }).click();

  const rail = page.getByTestId("route-rail");
  await expect(rail).toBeVisible({ timeout: 15_000 });
  // 每条一级路线都有入口，无论其投影标签在不在屏幕内
  for (const title of routeTitles) {
    await expect(rail.getByRole("button", { name: title })).toBeVisible();
  }

  // 点击第 3 条路线：放大定位到可读缩放，概览层（含导航栏）随之卸载
  await rail.getByRole("button", { name: "压测路线3" }).click();
  await expect(rail).toBeHidden({ timeout: 15_000 });
  const card = page.locator(".rm-card", { hasText: "压测路线3" }).first();
  const box = await card.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.width, "定位后的路线卡达到可读宽度").toBeGreaterThanOrEqual(MIN_READABLE_CARD_PX);
});
