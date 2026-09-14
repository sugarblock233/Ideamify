/** A6 一键展开/折叠工具条（方案 §2.3）。
 *
 *  用一条 5 级链 A→B→C→D→E 断言各档语义与计数：
 *  - 首开默认（A03）：只显示前两级（2 张卡）；
 *  - 全部展开 = 清空折叠（5 张卡），标签带可见节点计数；
 *  - 展开到第 1/3 层的可见数（2 / 4）；
 *  - 全部折叠只留顶层（1 张卡）；
 *  - 恢复上次在最末两批之间往返（含：卡片级手动折叠后的快照语义）；
 *  - 展开选中节点的分支只清子树内折叠；
 *  - 「只看这一分支」过滤不被工具清除（不清过滤）。
 *
 *  首开恢复上次按钮禁用（无快照）；每次 reload 后重新登录（令牌只在内存）。 */

import { expect, test, type Page } from "@playwright/test";
import { api, enterStudio, TOKEN } from "./helpers";

const BASE = `http://127.0.0.1:${process.env.E2E_PORT ?? 8021}`;

async function seedChain(page: Page, depth: number): Promise<{ pid: string; a: string }> {
  const ids = Array.from({ length: depth }, () => crypto.randomUUID());
  const name = `E2E 链-${crypto.randomUUID().slice(0, 8)}`;
  let r = await api(page, "POST", "/api/v1/projects", {
    request_id: crypto.randomUUID(),
    name,
    objective: "A6：一键展开/折叠语义",
  });
  expect(r.status, JSON.stringify(r.json)).toBe(200);
  const pid = r.json.id;
  const rev = (await api(page, "GET", `/api/v1/projects/${pid}`)).json.revision;
  r = await api(page, "POST", `/api/v1/projects/${pid}/commits`, {
    request_id: crypto.randomUUID(),
    expected_revision: rev,
    client_label: "seed-chain",
    summary: `e2e ${depth} 级链`,
    operations: ids.map((id, i) => ({
      op: "node.create", id, parent_id: i === 0 ? null : ids[i - 1],
      kind: "idea", title: `链${i + 1}级`, summary: `链第 ${i + 1} 级`,
      status: "in_progress",
    })),
  });
  expect(r.status, JSON.stringify(r.json)).toBe(200);
  return { pid, a: ids[0]! };
}

const card = (page: Page, text: string) => page.locator(".rm-card", { hasText: text });

async function openMenu(page: Page) {
  await page.getByTestId("view-toolbar").getByRole("button").nth(2).click();
}

test("首开 2 卡 → 全部展开 5 卡（带计数）→ 第 1/3 层 → 全部折叠 → 恢复上次往返", async ({ page }) => {
  const s = await seedChain(page, 5);
  await enterStudio(page, s.pid);
  await expect(card(page, "链3级")).toHaveCount(0, { timeout: 20_000 });
  await expect(page.locator(".rm-card")).toHaveCount(2);

  // 未执行过任何批工具：恢复上次禁用
  await openMenu(page);
  await expect(page.getByTestId("vt-restore")).toHaveClass(/muted/);
  await page.mouse.click(10, 300); // 点击工具条外关闭菜单

  const nVisible = await page.getByTestId("vt-expand-all").evaluate(
    (el) => Number(/·\s*(\d+)/.exec(el.textContent ?? "")?.[1] ?? 0),
  );
  expect(nVisible).toBe(2);

  await page.getByTestId("vt-expand-all").click();
  await expect(page.locator(".rm-card")).toHaveCount(5);

  await openMenu(page);
  await page.getByTestId("vt-level-1").click();
  await expect(page.locator(".rm-card")).toHaveCount(2);
  await expect(card(page, "链1级")).toHaveCount(1);
  await expect(card(page, "链2级")).toHaveCount(1);

  await openMenu(page);
  await page.getByTestId("vt-level-3").click();
  await expect(page.locator(".rm-card")).toHaveCount(4);
  await expect(card(page, "链5级")).toHaveCount(0);

  await page.getByTestId("vt-collapse-all").click();
  await expect(page.locator(".rm-card")).toHaveCount(1);

  // 恢复上次：回到上一批（第 3 层）前的 {链4折叠} 状态 → 4 卡
  await openMenu(page);
  await page.getByTestId("vt-restore").click();
  await expect(page.locator(".rm-card")).toHaveCount(4);

  // 再按一次：与上一批互换 → 回到 1 卡
  await openMenu(page);
  await page.getByTestId("vt-restore").click();
  await expect(page.locator(".rm-card")).toHaveCount(1);
});

test("卡片级手动折叠参与快照；恢复上次保留手动折叠结果", async ({ page }) => {
  const s = await seedChain(page, 5);
  await enterStudio(page, s.pid);
  await expect(card(page, "链3级")).toHaveCount(0, { timeout: 20_000 });

  await page.getByTestId("vt-expand-all").click(); // snapshot = 首开默认折叠集
  await expect(page.locator(".rm-card")).toHaveCount(5);

  // 卡片级手动折叠 B（不入快照）：画布回到 2 卡
  await card(page, "链2级").first().locator(".fold-btn").click();
  await expect(page.locator(".rm-card")).toHaveCount(2);

  // 同一工具再按：快照捕获的是「手动折叠后」的集合，而非更早的默认折叠
  await page.getByTestId("vt-expand-all").click();
  await expect(page.locator(".rm-card")).toHaveCount(5);

  await openMenu(page);
  await page.getByTestId("vt-restore").click();
  await expect(card(page, "链3级")).toHaveCount(0); // B 折叠：C 不可见
  await expect(page.locator(".rm-card")).toHaveCount(2);
});

test("展开选中节点的分支只清子树内折叠；分支过滤不被清除", async ({ page }) => {
  const s = await seedChain(page, 5);
  await enterStudio(page, s.pid);
  await expect(card(page, "链3级")).toHaveCount(0, { timeout: 20_000 });

  // 分支聚焦到二级（链2级）：画布只画这条分支
  const revision = (await api(page, "GET", `/api/v1/projects/${s.pid}`)).json.revision;
  await page.locator(".rm-card", { hasText: "链2级" }).first().click({ button: "right" });
  await page.getByText("只看这一分支").click();
  await expect(page.locator(".rm-card")).toHaveCount(1); // 链2（自身在默认折叠集中）

  await page.getByTestId("vt-expand-all").click();
  await expect(page.locator(".rm-card")).toHaveCount(4); // 链2..链5，链1 仍被过滤

  // 全部折叠后展开选中子分支：链2 选中 → 清它子树内的折叠
  await page.getByTestId("vt-collapse-all").click();
  await expect(page.locator(".rm-card")).toHaveCount(1);
  await card(page, "链2级").first().click();
  await expect(page.locator("h2", { hasText: "链2级" })).toBeVisible();
  await openMenu(page);
  await page.getByTestId("vt-subtree").click();
  await expect(page.locator(".rm-card")).toHaveCount(4);

  // 分支过滤没被批工具清掉：面包屑仍在分支视图
  await expect(page.locator(".breadcrumbs", { hasText: "链1级" })).toBeVisible();
  void revision;
});
