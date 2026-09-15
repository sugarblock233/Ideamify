/** D3/D5 受管附件端到端（SPEC §9 / DECISIONS §18）：
 *
 *  - 「插入图片」上传 → 引用入 details_md → 保存后 staged→attached，
 *    刷新重登后阅读视图仍能经认证字节流加载（Bearer 不进 URL）；
 *  - 粘贴图片（ClipboardEvent 携 file）→ 同一上传路径；非图片粘贴不上传；
 *  - 取消草稿：无任何提交、无 attached 翻转（staged 留给 30 天 GC）；
 *  - 外链图片永不加载，降级为占位条显示 URL 文本。
 */

import { expect, test, type Page } from "@playwright/test";
import { api, enterStudio } from "./helpers";

// 1×1 红 PNG（与后端 api_smoke 同源的最小合法图片）
const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

async function makeProject(page: Page, name: string) {
  const r = await api(page, "POST", "/api/v1/projects", {
    request_id: crypto.randomUUID(),
    name,
    objective: "D 批：受管附件",
  });
  expect(r.status, JSON.stringify(r.json)).toBe(200);
  const pid = r.json.id as string;
  const rev = (await api(page, "GET", `/api/v1/projects/${pid}`)).json.revision as number;
  return { pid, rev };
}

async function seedRoute(page: Page, pid: string, rev: number, title: string) {
  const r = await api(page, "POST", `/api/v1/projects/${pid}/commits`, {
    request_id: crypto.randomUUID(),
    expected_revision: rev,
    client_label: "seed",
    summary: "e2e 附件宿主",
    operations: [
      { op: "node.create", id: crypto.randomUUID(), parent_id: null, kind: "question",
        title, summary: "占位", status: "in_progress" },
    ],
  });
  expect(r.status, JSON.stringify(r.json)).toBe(200);
  return r.json.revision as number;
}

/** 选中节点 → 编辑 → 展开正文。 */
async function openDetailsEditor(page: Page, title: string) {
  await page.locator(".rm-card", { hasText: title }).first().click();
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  await page.getByRole("button", { name: /长说明/ }).click();
  return page.getByTestId("md-editor");
}

test("上传 → 引用入正文 → 保存翻转 attached → 重登可加载", async ({ page }) => {
  const { pid, rev } = await makeProject(page, `E2E 附件-${crypto.randomUUID().slice(0, 8)}`);
  await seedRoute(page, pid, rev, "附件宿主路线");
  await enterStudio(page, pid);

  const md = await openDetailsEditor(page, "附件宿主路线");
  await page.getByTestId("md-image-input").setInputFiles({
    name: "谱图.png", mimeType: "image/png", buffer: PNG_1X1,
  });
  await expect(md).toHaveValue(/!\[谱图\.png\]\(attachment:[0-9a-f-]{36}\)/);
  const ref = (await md.inputValue()).match(/attachment:([0-9a-f-]{36})/)![1];

  await Promise.all([
    page.waitForResponse((r) => r.url().includes("/commits") && r.request().method() === "POST"),
    page.getByRole("button", { name: "保存" }).click(),
  ]);
  await expect(page.locator(".hint.err")).toHaveCount(0);

  const list = (await api(page, "GET", `/api/v1/projects/${pid}/attachments`)).json;
  const row = list.items.find((i: { id: string }) => i.id === ref);
  expect(row.state).toBe("attached");

  // 刷新重登：阅读视图经认证 fetch 渲染
  await enterStudio(page, pid);
  await page.locator(".rm-card", { hasText: "附件宿主路线" }).first().click();
  // 有正文时长说明默认展开，附件图应已渲染
  const img = page.locator(`[data-testid="att-img-${ref.slice(0, 8)}"] img`);
  await expect(img).toBeVisible();
  expect(await img.getAttribute("src")).toMatch(/^blob:/); // Bearer 永不在 URL

  // Lightbox：点击放大，Esc 关闭
  await page.locator(`[data-testid="att-img-${ref.slice(0, 8)}"]`).click();
  await expect(page.getByTestId("att-lightbox")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("att-lightbox")).toHaveCount(0);
});

test("编辑模式预览：正文与附件分段渲染", async ({ page }) => {
  const { pid, rev } = await makeProject(page, `E2E 预览-${crypto.randomUUID().slice(0, 8)}`);
  await seedRoute(page, pid, rev, "预览宿主路线");
  await enterStudio(page, pid);

  const md = await openDetailsEditor(page, "预览宿主路线");
  await page.getByTestId("md-image-input").setInputFiles({
    name: "预览.png", mimeType: "image/png", buffer: PNG_1X1,
  });
  await expect(md).toHaveValue(/attachment:[0-9a-f-]{36}/);

  await page.getByRole("button", { name: "预览渲染" }).click();
  const body = page.locator(".md-body");
  await expect(body.locator("strong")).toHaveCount(0); // 原始 HTML 不解析（无 HTML 输入）
  await expect(body.getByRole("img", { name: /（删）/ })).toHaveCount(0);
});

test("粘贴图片走同一上传路径；非图片粘贴不上传", async ({ page }) => {
  const { pid, rev } = await makeProject(page, `E2E 粘贴-${crypto.randomUUID().slice(0, 8)}`);
  await seedRoute(page, pid, rev, "粘贴宿主路线");
  await enterStudio(page, pid);

  const md = await openDetailsEditor(page, "粘贴宿主路线");
  await md.evaluate(
    (el, bytes) => {
      const dt = new DataTransfer();
      dt.items.add(new File([new Uint8Array(bytes)], "粘贴.png", { type: "image/png" }));
      el.dispatchEvent(
        new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }) as ClipboardEvent,
      );
    },
    Array.from(PNG_1X1),
  );
  await expect(md).toHaveValue(/!\[粘贴\.png\]\(attachment:[0-9a-f-]{36}\)/);

  // 非图片文件不触发上传
  const before = await md.inputValue();
  await md.evaluate((el) => {
    const dt = new DataTransfer();
    dt.items.add(new File(["<xml/>"], "数据.xml", { type: "text/xml" }));
    el.dispatchEvent(
      new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }) as ClipboardEvent,
    );
  });
  await expect(md).toHaveValue(before);
});

test("取消草稿：无提交、无 attached 翻转", async ({ page }) => {
  const { pid, rev } = await makeProject(page, `E2E 取消-${crypto.randomUUID().slice(0, 8)}`);
  const rev2 = await seedRoute(page, pid, rev, "取消宿主路线");
  await enterStudio(page, pid);

  await page.getByRole("button", { name: "+ 一级路线" }).click();
  await page.getByTestId("draft-heading").waitFor();
  await page.locator(".editform input").first().fill("草稿含图");
  await page.getByRole("button", { name: /长说明/ }).click();
  await page.getByTestId("md-image-input").setInputFiles({
    name: "没存.png", mimeType: "image/png", buffer: PNG_1X1,
  });
  await expect(page.getByTestId("md-editor")).toHaveValue(/attachment:[0-9a-f-]{36}/);

  await page.getByRole("button", { name: "取消（恢复原值）" }).click();
  await expect(page.getByTestId("draft-heading")).toHaveCount(0);

  const revNow = (await api(page, "GET", `/api/v1/projects/${pid}`)).json.revision as number;
  expect(revNow).toBe(rev2); // 无提交
  const items = (await api(page, "GET", `/api/v1/projects/${pid}/attachments`)).json.items;
  expect(items).toHaveLength(1);
  expect(items[0].state).toBe("staged"); // 只停留在暂存，等 30 天 GC
});

test("外链图片不加载，降级为占位条（含 URL 文本）", async ({ page }) => {
  const { pid, rev } = await makeProject(page, `E2E 外链-${crypto.randomUUID().slice(0, 8)}`);
  await api(page, "POST", `/api/v1/projects/${pid}/commits`, {
    request_id: crypto.randomUUID(),
    expected_revision: rev,
    client_label: "seed",
    summary: "外链宿主",
    operations: [
      { op: "node.create", id: crypto.randomUUID(), parent_id: null, kind: "question",
        title: "外链宿主路线", summary: "占位",
        details_md: "看这张 ![外](https://外部.example/a.png) 图", status: "in_progress" },
    ],
  });
  await enterStudio(page, pid);

  let externalFetch = 0;
  await page.route(/外部\.example/, (route) => { externalFetch += 1; return route.abort(); });

  await page.locator(".rm-card", { hasText: "外链宿主路线" }).first().click();
  // 有正文时 ReadView 的长说明默认展开（detailsOpen 初始为 true）
  const ph = page.getByTestId("att-external");
  await expect(ph).toBeVisible();
  await expect(ph).toContainText("不加载");
  await expect(ph).toContainText("https://外部.example/a.png");
  expect(externalFetch).toBe(0);
});

test("F01: 上传等待期间的新输入不被回调覆盖；取消会话后不写回", async ({ page }) => {
  const { pid, rev } = await makeProject(page, `E2E 竞态-${crypto.randomUUID().slice(0, 8)}`);
  await seedRoute(page, pid, rev, "竞态宿主路线");
  await enterStudio(page, pid);

  // 延迟回执：服务器已入库，但浏览器先继续编辑 2.5s 再收到响应
  await page.route("**/api/v1/projects/*/attachments", async (route) => {
    if (route.request().method() !== "POST") return route.continue_();
    const resp = await page.request.fetch(route.request());
    await new Promise((s) => setTimeout(s, 2500));
    await route.fulfill({ response: resp });
  });

  const nodeDetail = await openDetailsEditor(page, "竞态宿主路线");
  const titleBox = page.locator(".editform input").first();
  const md = nodeDetail;
  await page.getByTestId("md-image-input").setInputFiles({
    name: "慢图.png", mimeType: "image/png", buffer: PNG_1X1,
  });
  // 等待期间改标题 + 改正文（整段替换，最严的并发形状）
  await titleBox.fill("上传期间新输入：不应该丢失");
  await md.fill("上传期间新增的正文：必须保留");
  // 上传回执到达：引用必须落在「新」正文之后，标题等其他字段不被回退
  await expect(md).toHaveValue(/attachment:[0-9a-f-]{36}/);
  const mdValue = await md.inputValue();
  expect(mdValue).toContain("上传期间新增的正文：必须保留");
  expect(mdValue.indexOf("上传期间新增的正文")).toBeLessThan(mdValue.indexOf("attachment:"));
  await expect(titleBox).toHaveValue("上传期间新输入：不应该丢失");
  await page.unroute("**/api/v1/projects/*/attachments");

  // 保存：走一次真提交确认整体一致
  const nid = (await api(page, "GET", `/api/v1/projects/${pid}/graph`)).json.nodes[0].id as string;
  await Promise.all([
    page.waitForResponse((r) => r.url().includes("/commits") && r.request().method() === "POST"),
    page.getByRole("button", { name: "保存" }).click(),
  ]);
  const node = (await api(page, "GET", `/api/v1/projects/${pid}/nodes/${nid}`)).json;
  expect(node.title).toBe("上传期间新输入：不应该丢失");
  expect(node.details_md).toContain("attachment:");
  expect(node.details_md).toContain("上传期间新增的正文");
});

test("F01: 取消会话后，迟到回执不写入新会话的草稿", async ({ page }) => {
  const { pid, rev } = await makeProject(page, `E2E 迟到-${crypto.randomUUID().slice(0, 8)}`);
  const rev2 = await seedRoute(page, pid, rev, "迟到宿主路线");
  await enterStudio(page, pid);

  await page.route("**/api/v1/projects/*/attachments", async (route) => {
    if (route.request().method() !== "POST") return route.continue_();
    const resp = await page.request.fetch(route.request());
    await new Promise((s) => setTimeout(s, 2000));
    await route.fulfill({ response: resp });
  });

  // 新建草稿会话：上传进行中取消整个会话（CreateDraftTab 卸载）
  await page.getByRole("button", { name: "+ 一级路线" }).click();
  await page.getByTestId("draft-heading").waitFor();
  await page.locator(".editform input").first().fill("迟到草稿将被取消");
  await page.getByRole("button", { name: /长说明/ }).click();
  await page.getByTestId("md-image-input").setInputFiles({
    name: "迟到.png", mimeType: "image/png", buffer: PNG_1X1,
  });
  await expect(page.getByTestId("md-editor")).toBeVisible();
  await page.getByRole("button", { name: "取消（恢复原值）" }).click(); // 表单卸载，回执未到
  await page.getByTestId("draft-heading").waitFor({ state: "detached" });

  // 迟到回执落空后重开新会话：新草稿正文不含任何 attachment 引用
  await page.getByRole("button", { name: "+ 一级路线" }).click();
  await page.getByTestId("draft-heading").waitFor();
  await page.getByRole("button", { name: /长说明/ }).click();
  const md = page.getByTestId("md-editor");
  await page.waitForTimeout(2200); // 越过延迟回执
  await expect(md).toBeVisible();
  await expect(md).not.toHaveValue(/attachment:/);

  // 无 attached 翻转，无提交
  const revNow = (await api(page, "GET", `/api/v1/projects/${pid}`)).json.revision as number;
  expect(revNow).toBe(rev2);
  const items = (await api(page, "GET", `/api/v1/projects/${pid}/attachments`)).json.items;
  expect(items).toHaveLength(1);
  expect(items[0].state).toBe("staged");
});
