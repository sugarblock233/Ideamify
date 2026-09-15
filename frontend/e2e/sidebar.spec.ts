/** A5 侧栏：可拖动、可收起、窄屏抽屉（方案 §4）。
 *
 *  覆盖：
 *  - 首次进入（无偏好、无选中）默认收起；rail 展开后再进即记住展开；
 *  - 拖动手柄改宽 → 刷新重登后宽度自动恢复（rm.prefs.app，localStorage）；
 *  - 拖动只改布局：画布视口 transform 前后一致（不触发 refit）；
 *  - 收起只藏不清：编辑中收起再展开，textarea 草稿原样保留（SidePanel
 *    从不卸载，DetailTab 的本地 editing 状态存活）；
 *  - <1000px 可用宽 → 覆盖式抽屉：把手隐藏、画布保持满宽、面板浮在上层；
 *  - 把手 role=separator，键盘 ← 加宽。
 *
 *  Token 只存内存：每次 reload 后都要重新走一次 enterStudio。 */

import { expect, test, type Page } from "@playwright/test";
import { enterStudio, seedDeepTree } from "./helpers";

function panel(page: Page) { return page.getByTestId("side-panel"); }
function handle(page: Page) { return page.getByTestId("side-handle"); }
function rail(page: Page) { return page.getByTestId("side-rail"); }

async function widthOf(page: Page) {
  return panel(page).evaluate((el) => Math.round(parseFloat(getComputedStyle(el).width)));
}
async function viewportStyle(page: Page) {
  return page.locator(".react-flow__viewport").getAttribute("style");
}

/** 从把手中心横向拖 dx（负值 = 加宽面板）。 */
async function dragHandle(page: Page, dx: number) {
  const box = (await handle(page).boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + dx, box.y + box.height / 2, { steps: 6 });
  await page.mouse.up();
}

test("首次默认收起；展开后拖宽不触发 refit；刷新恢复宽度", async ({ page }) => {
  const s = await seedDeepTree(page);
  await enterStudio(page, s.pid);
  await expect(page.locator(".rm-card").first()).toBeVisible({ timeout: 20_000 });

  // 无偏好首次进入：面板 CSS 隐藏（宽 0），元素仍挂载
  expect(await widthOf(page)).toBe(0);

  await rail(page).click();
  const w0 = await widthOf(page);
  expect(w0).toBeGreaterThanOrEqual(300);

  const t0 = await viewportStyle(page);
  await dragHandle(page, -80); // 向左拖 = 加宽
  const w1 = await widthOf(page);
  expect(w1).toBeGreaterThan(w0);
  expect(await viewportStyle(page), "拖动不得触发画布 refit").toBe(t0);

  await page.reload();
  await enterStudio(page, s.pid);
  await expect(page.locator(".rm-card").first()).toBeVisible({ timeout: 20_000 });
  expect(await widthOf(page), "刷新后宽度恢复（无需再点 rail）").toBe(w1);
});

test("收起只藏不清：编辑中的草稿在收起/展开间原样保留", async ({ page }) => {
  const s = await seedDeepTree(page);
  await enterStudio(page, s.pid, s.a);
  await expect(page.locator("h2", { hasText: "三层A" })).toBeVisible({ timeout: 20_000 });

  await page.getByRole("button", { name: "编辑", exact: true }).click();
  const titleInput = page.locator(".side input").first();
  await titleInput.fill("收起后仍在的标题草稿");

  await rail(page).click(); // 收起（CSS 隐藏）
  expect(await widthOf(page)).toBe(0);
  // 元素从未卸载：值仍在
  await expect(titleInput).toHaveValue("收起后仍在的标题草稿");

  await rail(page).click(); // 展开
  const w = await widthOf(page);
  expect(w).toBeGreaterThanOrEqual(300);
  await expect(titleInput).toHaveValue("收起后仍在的标题草稿");
});

test("键盘调宽：separator 聚焦后 ← 加宽、→ 收窄", async ({ page }) => {
  const s = await seedDeepTree(page);
  // 深链接带 node 进入 = 有选中 → 默认展开（无需点 rail）
  await enterStudio(page, s.pid, s.a);
  await expect(page.locator("h2", { hasText: "三层A" })).toBeVisible({ timeout: 20_000 });

  const w0 = await widthOf(page);
  expect(w0).toBeGreaterThanOrEqual(300);

  await handle(page).focus();
  await page.keyboard.press("ArrowLeft");
  const w1 = await widthOf(page);
  expect(w1).toBe(w0 + 24);

  await page.keyboard.press("ArrowRight");
  expect(await widthOf(page)).toBe(w0);
});

test("窄侧栏：详情内容跟随面板收缩，不产生横向溢出", async ({ page }) => {
  const s = await seedDeepTree(page);
  await enterStudio(page, s.pid, s.a);
  await expect(page.locator("h2", { hasText: "三层A" })).toBeVisible({ timeout: 20_000 });

  await page.getByRole("button", { name: "编辑", exact: true }).click();
  await dragHandle(page, 180); // 收窄到最小面板宽度

  const dimensions = await panel(page).evaluate((el) => ({
    clientWidth: el.clientWidth,
    scrollWidth: el.scrollWidth,
  }));
  expect(dimensions.scrollWidth, "详情内容不应撑出侧栏").toBeLessThanOrEqual(dimensions.clientWidth + 1);
  await expect(page.locator(".side .editform")).toBeVisible();
});

test("窄屏（<1000px）切换为覆盖式抽屉：把手消失、画布满宽、rail 仍可点", async ({ page }) => {
  const s = await seedDeepTree(page);
  await page.setViewportSize({ width: 900, height: 700 });
  await enterStudio(page, s.pid, s.a);
  await expect(page.locator("h2", { hasText: "三层A" })).toBeVisible({ timeout: 20_000 });

  await expect(page.locator(".side-zone.drawer")).toBeVisible();
  await expect(handle(page)).toBeHidden();

  // 面板浮在画布上方：画布仍占满整个工作区宽度
  const cw = await page.locator(".canvas-wrap").evaluate((el) => Math.round(el.getBoundingClientRect().width));
  expect(cw).toBeGreaterThan(800);

  // 抽屉态宽度被钳制在可用宽内
  const w = await widthOf(page);
  expect(w).toBeGreaterThanOrEqual(300);
  expect(w).toBeLessThanOrEqual(900);

  // 抽屉面板 absolute right:0 会盖住 rail 的位置：收起开关必须仍可点，
  // 且收起/展开往返后草稿仍在（不卸载）。
  await expect(panel(page).locator("h2", { hasText: "三层A" })).toBeVisible();
  await rail(page).click();
  expect(await widthOf(page)).toBe(0);
  await rail(page).click();
  const w2 = await widthOf(page);
  expect(w2).toBeGreaterThanOrEqual(300);
  await expect(panel(page).locator("h2", { hasText: "三层A" })).toBeVisible();

  // 拉宽窗口 → 抽屉模式退出，把手回归
  await page.setViewportSize({ width: 1400, height: 800 });
  await expect(page.locator(".side-zone.drawer")).toHaveCount(0);
  await expect(handle(page)).toBeVisible();
});
