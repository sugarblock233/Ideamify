/** B2 布局策略（DECISIONS §15）：横向/纵向树。
 *
 *  - ViewToolbar ⋾ 菜单里 vt-layout-h/v 切换，切换不改卡片存在性；
 *  - 纵向树沿 +Y 生长（父卡在上、子卡在下），横向树沿 +X；
 *  - 每个布局各自的折叠集独立保存/恢复（rm.view.<pid>.layouts.<mode>）；
 *  - 刷新后布局选择仍在（rm.prefs.<pid>.layout）。
 */

import { expect, test, type Page } from "@playwright/test";
import { api, enterStudio } from "./helpers";

async function cardBox(page: Page, title: string) {
  const box = await page.locator(".rm-card", { hasText: title }).first().boundingBox();
  expect(box, `card ${title} must be on screen`).not.toBeNull();
  return box!;
}

const openMenu = (page: Page) =>
  page.getByTestId("view-toolbar").getByRole("button").nth(2).click();

test("切纵向树：父子沿 +Y 生长；切回横向恢复横向折叠集", async ({ page }) => {
  const ids = Array.from({ length: 5 }, () => crypto.randomUUID());
  let r = await api(page, "POST", "/api/v1/projects", {
    request_id: crypto.randomUUID(),
    name: `E2E 布局-${crypto.randomUUID().slice(0, 8)}`,
    objective: "B2 纵向树/每布局视图",
  });
  expect(r.status).toBe(200);
  const pid = r.json.id as string;
  const rev = (await api(page, "GET", `/api/v1/projects/${pid}`)).json.revision as number;
  r = await api(page, "POST", `/api/v1/projects/${pid}/commits`, {
    request_id: crypto.randomUUID(),
    expected_revision: rev,
    client_label: "seed-layout",
    summary: "e2e 5级链",
    operations: ids.map((id, i) => ({
      op: "node.create", id, parent_id: i === 0 ? null : ids[i - 1],
      kind: "idea", title: `链${i + 1}级`, summary: `链第 ${i + 1} 级`,
      status: "in_progress",
    })),
  });
  expect(r.status).toBe(200);

  await enterStudio(page, pid);
  await page.waitForSelector(".rm-card", { timeout: 20_000 });

  // 默认横向树：A03 默认折叠→ 链1、链2 可见（链3+ 藏在链2 的折叠里）
  await expect(page.locator(".rm-card")).toHaveCount(2);
  const hParent = await cardBox(page, "链1级");
  const hChild = await cardBox(page, "链2级");
  expect(hChild.x).toBeGreaterThan(hParent.x); // 横向树沿 +X

  // 切纵向：默认同样是两层展开（首个槽未使用），卡片沿 +Y 排布
  await openMenu(page);
  await page.getByTestId("vt-layout-v").click();
  await page.mouse.click(10, 300);
  await expect(page.locator(".rm-card")).toHaveCount(2);
  const vParent = await cardBox(page, "链1级");
  const vChild = await cardBox(page, "链2级");
  expect(Math.abs(vChild.x - vParent.x)).toBeLessThan(30); // 同一列
  expect(vChild.y).toBeGreaterThan(vParent.y); // 纵向树沿 +Y

  // 纵向里全部展开：5 张卡 + 5 条树边（每个可见的链卡一条；
  // 根→链1 是正垂直线，bbox 宽 0，所以断言数量而不是可见性）
  await page.getByTestId("vt-expand-all").click();
  await expect(page.locator(".rm-card")).toHaveCount(5);
  await expect(page.locator(".react-flow__edge")).toHaveCount(5);

  // 切回横向：横向自己的折叠集回来了（仍是默认两层）；再切回纵向，5 张卡还在
  await openMenu(page);
  await page.getByTestId("vt-layout-h").click();
  await page.mouse.click(10, 300);
  await expect(page.locator(".rm-card")).toHaveCount(2);
  await openMenu(page);
  await page.getByTestId("vt-layout-v").click();
  await page.mouse.click(10, 300);
  await expect(page.locator(".rm-card")).toHaveCount(5);

  // 展开并收起链2：卡片折叠在纵向独立生效
  const vFold = page.locator(".rm-card", { hasText: "链2级" }).locator(".fold-btn");
  await vFold.click();
  await expect(page.locator(".rm-card")).toHaveCount(2);

  // 刷新（令牌只在内存token，重进）：依旧纵向 + 链2 折叠
  await enterStudio(page, pid);
  await page.waitForSelector(".rm-card", { timeout: 20_000 });
  await expect(page.locator(".rm-card")).toHaveCount(2);
  const vParent2 = await cardBox(page, "链1级");
  const vChild2 = await cardBox(page, "链2级");
  expect(vChild2.y).toBeGreaterThan(vParent2.y);
});

test("大纲视图：行语义与画布折叠一致；行点击选中；切回横向恢复画布", async ({ page }) => {
  const ids = Array.from({ length: 3 }, () => crypto.randomUUID());
  let r = await api(page, "POST", "/api/v1/projects", {
    request_id: crypto.randomUUID(),
    name: `E2E 大纲-${crypto.randomUUID().slice(0, 8)}`,
    objective: "B3 大纲视图",
  });
  expect(r.status).toBe(200);
  const pid = r.json.id as string;
  const rev = (await api(page, "GET", `/api/v1/projects/${pid}`)).json.revision as number;
  r = await api(page, "POST", `/api/v1/projects/${pid}/commits`, {
    request_id: crypto.randomUUID(),
    expected_revision: rev,
    client_label: "seed-outline",
    summary: "e2e 3级链",
    operations: ids.map((id, i) => ({
      op: "node.create", id, parent_id: i === 0 ? null : ids[i - 1],
      kind: "idea", title: `链${i + 1}级`, summary: "大纲素材",
      status: "in_progress",
    })),
  });
  expect(r.status).toBe(200);

  await enterStudio(page, pid);
  await page.waitForSelector(".rm-card", { timeout: 20_000 });

  await openMenu(page);
  await page.getByTestId("vt-layout-outline").click();
  await page.mouse.click(10, 300);

  // 画布退场，行进位；语义同画布：默认折叠 → 链1、链2 两行
  await expect(page.getByTestId("outline-view")).toBeVisible();
  await expect(page.locator(".rm-card")).toHaveCount(0);
  await expect(page.locator(".outline-row")).toHaveCount(2);

  // 行折叠走同一折叠集：展开到 3 行 → 折叠链2 回 2 行
  await page.getByTestId("vt-expand-all").click();
  await expect(page.locator(".outline-row")).toHaveCount(3);
  await page.locator(".outline-row", { hasText: "链2级" }).locator(".ofold").click();
  await expect(page.locator(".outline-row")).toHaveCount(2);

  // 行点击 = 选中（与 SidePanel 同一 selectNode）
  await page.locator(".outline-row", { hasText: "链1级" }).click();
  await expect(page.locator(".outline-row.selected", { hasText: "链1级" })).toBeVisible();

  // 切回横向：大纲退场，画布带着自己的折叠集回来
  await openMenu(page);
  await page.getByTestId("vt-layout-h").click();
  await page.mouse.click(10, 300);
  await expect(page.locator(".rm-card")).toHaveCount(2);
  await expect(page.getByTestId("outline-view")).toHaveCount(0);
});

test("大纲定位：搜索命中后展开祖先并 flash", async ({ page }) => {
  const ids = Array.from({ length: 3 }, () => crypto.randomUUID());
  let r = await api(page, "POST", "/api/v1/projects", {
    request_id: crypto.randomUUID(),
    name: `E2E 大纲定位-${crypto.randomUUID().slice(0, 8)}`,
    objective: "B3 大纲 · 搜索定位",
  });
  expect(r.status).toBe(200);
  const pid = r.json.id as string;
  const rev = (await api(page, "GET", `/api/v1/projects/${pid}`)).json.revision as number;
  r = await api(page, "POST", `/api/v1/projects/${pid}/commits`, {
    request_id: crypto.randomUUID(),
    expected_revision: rev,
    client_label: "seed-olocate",
    summary: "e2e 3级链",
    operations: ids.map((id, i) => ({
      op: "node.create", id, parent_id: i === 0 ? null : ids[i - 1],
      kind: "idea", title: `定位链${i + 1}级`, summary: "定位素材",
      status: "in_progress",
    })),
  });
  expect(r.status).toBe(200);

  await enterStudio(page, pid);
  await page.waitForSelector(".rm-card", { timeout: 20_000 });

  await openMenu(page);
  await page.getByTestId("vt-layout-outline").click();
  await page.mouse.click(10, 300);
  await expect(page.getByTestId("outline-view")).toBeVisible();

  // 全部折叠 → 只剩链1 一行；搜索链3 必须命中并带出祖先
  await page.getByTestId("vt-collapse-all").click();
  await expect(page.locator(".outline-row")).toHaveCount(1);
  await page.getByPlaceholder("搜索标题/摘要/标签/观察/结论（中文子串可用）").fill("定位链3");
  await page.locator(".pop-item", { hasText: "定位链3级" }).first().click();
  await expect(page.locator(".outline-row", { hasText: "定位链3级" })).toHaveCount(1, {
    timeout: 10_000,
  });
  await expect(page.locator(".outline-row")).toHaveCount(3);
  // locateNode 选中 + OutlineView flash：类上同时有 selected 与 flash
  await expect
    .poll(
      () =>
        page.locator(".outline-row", { hasText: "定位链3级" }).first().getAttribute("class"),
      { timeout: 4000 },
    )
    .toContain("selected flash");
});
