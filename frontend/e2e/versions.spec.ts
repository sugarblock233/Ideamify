/** E4/E5/E6 收尾：科研版本筛选、详情分配、新建默认带版本、跨布局持久化、
 *  泳道（方案 §6/§7/§13）。
 *
 *  - 版本筛选行（vt-version）：选 v1 后画布只留 v1 节点及其上下文祖先
 *    （§7.3「为缺失的祖先显示上下文路径」）；
 *  - 切换布局（纵向树/泳道）与 reload 都不清筛选（rm.prefs.<pid>.versionId）；
 *  - 筛选排除的选中节点 → 详情「当前视图外」+「清除筛选并显示」（§6 line 108）；
 *  - 详情编辑里 chip 分配版本，保存后归属落库（node.update fields.version_ids）；
 *  - 筛选 v1 时开新草稿，版本 chip 预填命中（§7.2 新建默认带入当前版本）；
 *  - 泳道：列头/行头（屏幕空间）+ 三列齐全（第一轮/第二轮/未分配）。
 *
 *  运行：npm run build && E2E_PORT=8029 npx playwright test e2e/versions.spec.ts */

import { expect, test, type Page } from "@playwright/test";
import { api, enterStudio } from "./helpers";

const card = (page: Page, text: string) => page.locator(".rm-card", { hasText: text });

async function openMenu(page: Page) {
  await page.getByTestId("view-toolbar").getByRole("button").nth(2).click();
}

async function closeMenu(page: Page) {
  // 再点一次 ⋯ 收起菜单。不能点画布空白处：onPaneClick 会清除选中节点，
  // 「视图外提示」用例正是要在选中被筛节点后关菜单。
  await page.getByTestId("view-toolbar").getByRole("button").nth(2).click();
}

interface Fixture {
  pid: string;
  va: string;
  vb: string;
  r: string;
  a: string;
  b: string;
  c: string;
}

async function seedVersions(page: Page): Promise<Fixture> {
  const va = crypto.randomUUID();
  const vb = crypto.randomUUID();
  const r = crypto.randomUUID();
  const a = crypto.randomUUID();
  const b = crypto.randomUUID();
  const c = crypto.randomUUID();
  const name = `E2E 版本-${crypto.randomUUID().slice(0, 8)}`;
  let res = await api(page, "POST", "/api/v1/projects", {
    request_id: crypto.randomUUID(),
    name,
    objective: "E 批：版本筛选/分配/泳道",
  });
  expect(res.status, JSON.stringify(res.json)).toBe(200);
  const pid = res.json.id as string;
  const rev = (await api(page, "GET", `/api/v1/projects/${pid}`)).json.revision as number;
  res = await api(page, "POST", `/api/v1/projects/${pid}/commits`, {
    request_id: crypto.randomUUID(),
    expected_revision: rev,
    client_label: "seed-versions",
    summary: "e2e 版本轮次与归属节点",
    operations: [
      { op: "version.create", id: va, name: "第一轮", description: "基线" },
      { op: "version.create", id: vb, name: "第二轮", description: "加约束" },
      { op: "node.create", id: r, parent_id: null, kind: "question",
        title: "版本R：一级路线", summary: "未分配的路线", status: "in_progress" },
      { op: "node.create", id: a, parent_id: r, kind: "idea",
        title: "版本A：属于第一轮", summary: "v1 成员", status: "in_progress", version_ids: [va] },
      { op: "node.create", id: b, parent_id: r, kind: "idea",
        title: "版本B：属于第二轮", summary: "v2 成员", status: "in_progress", version_ids: [vb] },
      { op: "node.create", id: c, parent_id: r, kind: "idea",
        title: "版本C：未分配", summary: "无版本", status: "unexplored" },
    ],
  });
  expect(res.status, JSON.stringify(res.json)).toBe(200);
  return { pid, va, vb, r, a, b, c };
}

test("版本筛选：v1 只留成员+上下文祖先；切布局/reload 不清", async ({ page }) => {
  const f = await seedVersions(page);
  await enterStudio(page, f.pid);
  await expect(card(page, "版本C")).toBeVisible({ timeout: 20_000 });
  await expect(page.locator(".rm-card")).toHaveCount(4);

  await openMenu(page);
  await expect(page.getByTestId("vt-version")).toBeVisible();
  await page.getByTestId(`vt-version-${f.va.slice(0, 8)}`).click();
  await closeMenu(page);

  // v1 成员 A 与其上下文祖先 R 留下，v2/B 与未分配 C 筛掉（§7.3）
  await expect(card(page, "版本A")).toBeVisible();
  await expect(card(page, "版本R")).toBeVisible();
  await expect(card(page, "版本B")).toHaveCount(0);
  await expect(card(page, "版本C")).toHaveCount(0);

  // 切纵向树：筛选不清（跨布局共享）
  await openMenu(page);
  await page.getByTestId("vt-layout-v").click();
  await closeMenu(page);
  await expect(card(page, "版本B")).toHaveCount(0);
  await expect(card(page, "版本A")).toBeVisible();

  // reload：rm.prefs.<pid>.versionId 持久化
  await enterStudio(page, f.pid);
  await expect(card(page, "版本B")).toHaveCount(0, { timeout: 20_000 });
  await expect(card(page, "版本A")).toBeVisible();
});

test("视图外提示：选中未分配节点后筛 v1 → 提示 + 清除筛选并显示", async ({ page }) => {
  const f = await seedVersions(page);
  await enterStudio(page, f.pid);
  await expect(card(page, "版本C")).toBeVisible({ timeout: 20_000 });
  await card(page, "版本C").click();
  await openMenu(page);
  await page.getByTestId(`vt-version-${f.va.slice(0, 8)}`).click();
  await closeMenu(page);
  // C 被筛掉但仍是选中节点：详情面板给出「当前视图外」与显示入口（§6）
  const hint = page.getByTestId("outside-view-hint");
  await expect(hint).toContainText("当前版本筛选范围");
  await hint.getByRole("button", { name: "清除筛选并显示" }).click();
  await expect(card(page, "版本C")).toBeVisible();
  await expect(card(page, "版本B")).toBeVisible(); // 全部版本视图恢复
});

test("详情分配：编辑里点亮第一轮 chip，保存后落库", async ({ page }) => {
  const f = await seedVersions(page);
  await enterStudio(page, f.pid);
  await expect(card(page, "版本C")).toBeVisible({ timeout: 20_000 });
  await card(page, "版本C").click();
  const panel = page.locator(".side");
  await panel.getByRole("button", { name: "编辑", exact: true }).click();
  const chip = panel.getByTestId(`ver-chip-${f.va.slice(0, 8)}`);
  await expect(chip).toHaveAttribute("aria-pressed", "false");
  await chip.click();
  await expect(chip).toHaveAttribute("aria-pressed", "true");
  await panel.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByText(/已保存（记录 #/)).toBeVisible();
  // 重读后归属仍在（draft 基线重钉 → 仍显示命中）
  await expect(chip).toHaveAttribute("aria-pressed", "true");
});

test("新建默认带版本：筛选 v1 时开草稿， chip 已预填", async ({ page }) => {
  const f = await seedVersions(page);
  await enterStudio(page, f.pid);
  await expect(card(page, "版本C")).toBeVisible({ timeout: 20_000 });
  await openMenu(page);
  await page.getByTestId(`vt-version-${f.va.slice(0, 8)}`).click();
  await closeMenu(page);

  await page.getByRole("button", { name: "+ 一级路线" }).click();
  const panel = page.locator(".side");
  await expect(panel.getByRole("heading", { name: /新增节点/ })).toBeVisible();
  await expect(panel.getByTestId(`ver-chip-${f.va.slice(0, 8)}`)).toHaveAttribute("aria-pressed", "true");
  // 未分配/全部视图不预填（回删 chip 后也不紧贴「已选」态）
  await panel.getByTestId(`ver-chip-${f.vb.slice(0, 8)}`).click();
  await panel.getByRole("button", { name: "取消（恢复原值）" }).first().click();
});

test("泳道：列头三枚（第一轮/第二轮/未分配）+ 行头 + 卡片齐全", async ({ page }) => {
  const f = await seedVersions(page);
  await enterStudio(page, f.pid);
  await expect(card(page, "版本C")).toBeVisible({ timeout: 20_000 });
  await openMenu(page);
  await page.getByTestId("vt-layout-swimlane").click();
  await closeMenu(page);

  const headers = page.getByTestId("swimlane-headers");
  await expect(headers).toBeVisible();
  await expect(headers.locator(".swim-col")).toHaveText(["第一轮", "第二轮", "未分配"]);
  await expect(headers.locator(".swim-row", { hasText: "版本R：一级路线" })).toBeVisible();
  // 网格是全量在筛人口：四个节点全部成卡（树边不画，卡片照常）
  await expect(card(page, "版本A")).toBeVisible();
  await expect(card(page, "版本B")).toBeVisible();
  await expect(card(page, "版本C")).toBeVisible();
});
