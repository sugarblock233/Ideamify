/** Synthetic projects against an isolated local-mode server; no login steps. */
import { test, expect } from "@playwright/test";

test("local manager: create, search, switch, refresh and retain a draft on cancelled return", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "我的研究项目" })).toBeVisible();
  await expect(page.locator('input[type="password"]')).toHaveCount(0);
  await expect(page.getByRole("button", { name: "退出", exact: true })).toHaveCount(0);
  const name = `Synthetic local ${crypto.randomUUID().slice(0, 8)}`;
  if (!(await page.getByPlaceholder("如：富锂锰基正极的循环衰减机制").isVisible())) {
    await page.getByRole("button", { name: "+ 新建项目", exact: true }).click();
  }
  await page.getByPlaceholder("如：富锂锰基正极的循环衰减机制").fill(name);
  await page.getByPlaceholder("你要回答什么问题？").fill("Synthetic research objective for local testing");
  await page.getByRole("button", { name: "创建项目", exact: true }).click();
  await expect(page.locator(".project-sel")).toContainText(name);
  const pid = await page.locator(".project-sel").inputValue();
  await page.getByRole("button", { name: "+ 一级路线", exact: true }).click();
  const title = page.locator(".side .editform input").first();
  await title.fill("Synthetic unsaved route");
  page.once("dialog", (dialog) => dialog.dismiss());
  await page.getByRole("button", { name: "返回项目管理", exact: true }).click();
  await expect(title).toHaveValue("Synthetic unsaved route");
  await page.getByTestId("draft-save").click();
  await expect(page.getByTestId("draft-save")).toHaveCount(0);
  await page.getByRole("button", { name: "返回项目管理", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  const other = await page.request.post("/api/v1/projects", { headers: { "x-researchmap-request": "1" },
    data: { request_id: crypto.randomUUID(), name: "Synthetic second project", objective: "A separate map" } });
  expect(other.ok()).toBeTruthy();
  await page.getByRole("button", { name: "刷新项目列表" }).click();
  await expect(page.getByTestId("project-card")).toHaveCount(2);
  await page.getByPlaceholder("搜索项目名称或研究目标").fill(name);
  await expect(page.getByTestId("project-card")).toHaveCount(1);
  await page.getByTestId("project-card").click();
  await expect(page.locator(".project-sel")).toHaveValue(pid);
  await page.reload();
  await expect(page.locator(".project-sel")).toHaveValue(pid);
  await expect(page.locator(".rm-card", { hasText: "Synthetic unsaved route" })).toHaveCount(1);
  await expect(page.locator('input[type="password"]')).toHaveCount(0);
  await page.getByRole("button", { name: "返回项目管理", exact: true }).click();
  await page.getByRole("button", { name: "进入项目：Synthetic second project", exact: true }).click();
  await expect(page.locator(".rm-card")).toHaveCount(0);
  await page.locator(".topbar .dotmenu").click();
  await page.getByText("AI 接入说明", { exact: true }).click();
  await expect(page.locator(".aiaccess-pre")).toContainText("本机免登录");
  await expect(page.locator(".aiaccess-pre")).not.toContainText("export RESEARCHMAP_TOKEN");
  expect(await page.context().cookies()).toEqual([]);
  const storage = await page.evaluate(() => JSON.stringify(localStorage));
  expect(storage).not.toMatch(/token|session/i);
});

test("local manager: narrow layout, bilingual UI and search empty state", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "我的研究项目" })).toBeVisible();
  await page.getByPlaceholder("搜索项目名称或研究目标").fill("no-such-synthetic-project");
  await expect(page.getByRole("heading", { name: "没有找到匹配的项目" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole("button", { name: "English", exact: true }).click();
  await expect(page.getByRole("heading", { name: "My research projects" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "My research projects" })).toBeVisible();
});
