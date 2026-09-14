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
