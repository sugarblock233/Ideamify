/** A7 自适应 TopBar 三档（方案 §3.1 增量：元素级测量，非窗口媒体查询）。
 *
 *  - 1280 默认 full：刷新/conn/退出照常在单行内；
 *  - 780 → more：行内刷新/conn/退出让位（.topbar 直接子元素断言），
 *    ⋯ 菜单顶部落位三个接管项（conn 只读 + 刷新 + 退出）；
 *  - 540 → icon：搜索收为 🔍 可展开入口（点开在行内还原，同一搜索状态）；
 *  - 回到 1280 → 回到 full（滞回上提不把行再次撑爆）。
 *
 *  档位由 ResizeObserver + 溢出测量收敛，断言都走 expect 自动重试。 */

import { expect, test } from "@playwright/test";
import { seedDeepTree, enterStudio } from "./helpers";

test("1280 为 full 单行", async ({ page }) => {
  const s = await seedDeepTree(page);
  await enterStudio(page, s.pid);
  await expect(page.locator(".topbar")).toHaveClass("topbar");
  await expect(page.locator(".topbar > button", { hasText: "刷新" })).toHaveCount(1);
  await expect(page.locator(".topbar > .conn")).toBeVisible();
  await expect(page.locator(".searchbox input")).toBeVisible();
});

test("780 宽为 more：三个行内件移入 ⋯ 菜单", async ({ page }) => {
  const s = await seedDeepTree(page);
  await enterStudio(page, s.pid);
  await page.setViewportSize({ width: 780, height: 700 });
  await expect(page.locator(".topbar")).toHaveClass(/tier-more/);
  // 行内让位（直接子元素断言，菜单接管项同名不误伤）
  await expect(page.locator(".topbar > button", { hasText: "刷新" })).toHaveCount(0);
  await expect(page.locator(".topbar > .conn")).toHaveCount(0);
  await expect(page.locator(".topbar > button", { hasText: "退出" })).toHaveCount(0);
  // ⋯ 菜单里可用：conn 只读 + 刷新 + 退出
  await page.locator("button.dotmenu").click();
  const pop = page.locator(".topbar .pop");
  await expect(pop.locator(".topbar-conn-item")).toBeVisible();
  await expect(pop.locator(".dotmenu-line", { hasText: "刷新" })).toBeVisible();
  await expect(page.locator(".topbar .pop .pop-item", { hasText: "退出" })).toBeVisible();
  await page.mouse.click(10, 300);
  // 回到 1280：滞回上提后仍放得下 → full 且 conn 回归
  await page.setViewportSize({ width: 1280, height: 700 });
  await expect(page.locator(".topbar > .conn")).toBeVisible();
  await expect(page.locator(".topbar")).toHaveClass("topbar");
});

test("540 宽为 icon：搜索收为 🔍 入口，行内还原可用", async ({ page }) => {
  const s = await seedDeepTree(page);
  await enterStudio(page, s.pid);
  await page.setViewportSize({ width: 540, height: 700 });
  await expect(page.locator(".topbar")).toHaveClass(/tier-icon/);
  await expect(page.locator(".searchbox")).toHaveCount(0);
  await expect(page.getByTestId("topbar-search-toggle")).toBeVisible();
  await page.getByTestId("topbar-search-toggle").click();
  const input = page.locator(".searchbox.compact-search input");
  await expect(input).toBeVisible();
  await input.fill("三层");
  await expect(page.locator(".compact-search .pop-item", { hasText: "三层A" }).first()).toBeVisible();
  await page.mouse.click(10, 300); // 点外收回 🔍
  await expect(page.locator(".compact-search")).toHaveCount(0);
  await expect(page.getByTestId("topbar-search-toggle")).toBeVisible();
});
