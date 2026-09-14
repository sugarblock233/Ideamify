/** B1/B4 信息密度三档 + 低干扰（DECISIONS §14）。
 *
 *  - 默认阅读档（tier-reading），概要 Durset 可见；
 *  - 自动档由 zoom 驱动：Controls 连续缩小跨 0.70 死区→精简（隐藏概要），
 *    继续跨 0.33 → 概览（色块 + 概览层路线名/选中浮层）；
 *  - 回差：卡死区边界来回不换档（快速往返断言不抖）；
 *  - 密度锁（阅读/精简/概览/自动）直接透传，不动坐标；
 *  - 低干扰开启后卡片隐藏标签/计数、图例出现；刷新后偏好仍在。
 */

import { expect, test, type Page } from "@playwright/test";
import { api, enterStudio } from "./helpers";

async function zoomTimes(page: Page, btn: "in" | "out", n: number) {
  for (let i = 0; i < n; i++) {
    await page.locator(`.react-flow__controls-zoom${btn}`).click();
    await page.waitForTimeout(60);
  }
  await page.waitForTimeout(250);
}

test("自动档：缩小跨阈值逐级降档（含概览层），放大只跨死区回来", async ({ page }) => {
  // 5 级链 → 顶层唯一路线「链1级」，天然一条概览标签
  const ids = Array.from({ length: 5 }, () => crypto.randomUUID());
  let r = await api(page, "POST", "/api/v1/projects", {
    request_id: crypto.randomUUID(),
    name: `E2E 密度-${crypto.randomUUID().slice(0, 8)}`,
    objective: "B1 密度三档",
  });
  expect(r.status).toBe(200);
  const pid = r.json.id as string;
  const rev = (await api(page, "GET", `/api/v1/projects/${pid}`)).json.revision as number;
  r = await api(page, "POST", `/api/v1/projects/${pid}/commits`, {
    request_id: crypto.randomUUID(),
    expected_revision: rev,
    client_label: "seed-density",
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

  const card = page.locator(".rm-card").first();
  await expect(card).toHaveClass(/tier-reading/);
  await expect(page.locator(".rm-card .summary").first()).toBeVisible();

  // 0.7 → 每次缩 ×0.8：0.56(精简) → 0.448(精简) → 0.358(精简) → 0.287(概览)
  await zoomTimes(page, "out", 1);
  await expect(page.locator(".rm-card").first()).toHaveClass(/tier-compact/);
  await expect(page.locator(".rm-card .summary").first()).toBeHidden();
  await zoomTimes(page, "out", 2);
  await expect(page.locator(".rm-card").first()).toHaveClass(/tier-compact/); // 0.448>0.33
  await zoomTimes(page, "out", 1);
  await expect(page.locator(".rm-card").first()).toHaveClass(/tier-compact/); // 0.358 仍在滞回内
  await zoomTimes(page, "out", 1);
  await expect(page.locator(".rm-card").first()).toHaveClass(/tier-overview/);
  await expect(page.getByTestId("overview-layer")).toBeVisible();
  await expect(page.locator(".ov-label.ov-selected, .ov-label").first()).toBeVisible();
  await expect(page.locator(".ov-label", { hasText: "链1级" })).toBeVisible();

  // 回差：0.287 → 0.345 → 0.414：跨 0.37 后回到精简（阅读阈 0.72 未到）
  await zoomTimes(page, "in", 2);
  await expect(page.locator(".rm-card").first()).toHaveClass(/tier-compact/);
  await expect(page.getByTestId("overview-layer")).toHaveCount(0);
  await zoomTimes(page, "in", 4); // 0.414→0.497→0.596→0.716→0.859（须过 0.72）
  await expect(page.locator(".rm-card").first()).toHaveClass(/tier-reading/);
  await expect(page.locator(".rm-card .summary").first()).toBeVisible();
});

test("密度锁直接透传；低干扰隐藏标签/计数且刷新后保留", async ({ page }) => {
  const ids = Array.from({ length: 3 }, () => crypto.randomUUID());
  let r = await api(page, "POST", "/api/v1/projects", {
    request_id: crypto.randomUUID(),
    name: `E2E 低干扰-${crypto.randomUUID().slice(0, 8)}`,
    objective: "B4 密度锁 / 低干扰",
  });
  expect(r.status).toBe(200);
  const pid = r.json.id as string;
  const rev = (await api(page, "GET", `/api/v1/projects/${pid}`)).json.revision as number;
  r = await api(page, "POST", `/api/v1/projects/${pid}/commits`, {
    request_id: crypto.randomUUID(),
    expected_revision: rev,
    client_label: "seed-low",
    summary: "e2e 3级链",
    operations: ids.map((id, i) => ({
      op: "node.create", id, parent_id: i === 0 ? null : ids[i - 1],
      kind: "idea", title: `L${i + 1}`, summary: "低干扰素材",
      status: "promising",
    })),
  });
  expect(r.status).toBe(200);

  await enterStudio(page, pid);
  await page.waitForSelector(".rm-card", { timeout: 20_000 });

  // 展开全部后锁概览：立即换档（无视 zoom）。
  // 菜单内的 lock/分段/低干扰点击均不收起菜单，一次打开连点到结束。
  await page.getByTestId("vt-expand-all").click();
  const openMenu = () => page.getByTestId("view-toolbar").getByRole("button").nth(2).click();
  await openMenu();

  await page.getByTestId("vt-density-overview").click();
  await expect(page.locator(".rm-card").first()).toHaveClass(/tier-overview/);

  // 锁阅读：回阅读档（zoom 不变）
  await page.getByTestId("vt-density-reading").click();
  await expect(page.locator(".rm-card").first()).toHaveClass(/tier-reading/);
  await expect(page.locator(".rm-card .summary").first()).toBeVisible();

  // 分段控回「自动」再收菜单
  await page.getByTestId("vt-density-auto").click();
  await page.mouse.click(10, 300);

  // 低干扰：row3（计数/标签）隐藏、图例出现（图例在外部点击后会收菜单，
  // 所以低干扰单独开一次菜单）
  const openMenu2 = () => page.getByTestId("view-toolbar").getByRole("button").nth(2).click();
  await openMenu2();
  await page.getByTestId("vt-low-interf").click();
  await page.mouse.click(10, 300);
  await expect(page.locator(".rm-card").first()).toHaveClass(/low-interf/);
  await expect(page.locator(".rm-card .row3").first()).toBeHidden();
  await expect(page.getByTestId("legend-toggle")).toBeVisible();
  await page.getByTestId("legend-toggle").click();
  await expect(page.getByTestId("legend")).toContainText("未探索");

  // 刷新后：低干扰与自动档都还在（rm.prefs.<pid>）
  // 令牌只在内存：reload 后重登
  await enterStudio(page, pid);
  await page.waitForSelector(".rm-card", { timeout: 20_000 });
  await expect(page.locator(".rm-card").first()).toHaveClass(/low-interf/);
  await expect(page.locator(".rm-card .row3").first()).toBeHidden();
  await expect(page.locator(".rm-card").first()).toHaveClass(/tier-reading/);
});
