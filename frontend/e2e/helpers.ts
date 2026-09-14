/** Shared E2E helpers: scratch-API client, deep-tree seeder, studio entry.
 *  (Extracted from collab.spec.ts when sidebar.spec.ts needed them too —
 *  Playwright forbids importing one spec file from another.) */

import { expect, type Page } from "@playwright/test";

export const TOKEN = "e2e-test-token-0001";
export const OTHER_TOKEN = "e2e-other-token-0001";
export const BASE = `http://127.0.0.1:${process.env.E2E_PORT ?? 8021}`;

export async function api(
  page,
  method: string,
  path: string,
  body?: unknown,
  token: string = TOKEN,
) {
  const res = await page.request.fetch(`${BASE}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    data: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  const out = { status: res.status(), json };
  if (res.status() >= 400) {
    console.log(`[api] ${method} ${path} → ${res.status()} ${text.slice(0, 600)}`);
  }
  return out;
}

export interface Tree3 { pid: string; a: string; b: string; c: string; name: string }

/** 建项目并一条 commit 创建 A（一级）→ B（二级）→ C（三级）。 */
export async function seedDeepTree(page): Promise<Tree3> {
  const a = crypto.randomUUID();
  const b = crypto.randomUUID();
  const c = crypto.randomUUID();
  const name = `E2E 三层-${crypto.randomUUID().slice(0, 8)}`;
  let r = await api(page, "POST", "/api/v1/projects", {
    request_id: crypto.randomUUID(),
    name,
    objective: "A03/A07：三层树的首次打开与深链接定位",
  });
  expect(r.status, JSON.stringify(r.json)).toBe(200);
  const pid = r.json.id;
  const rev = (await api(page, "GET", `/api/v1/projects/${pid}`)).json.revision;
  r = await api(page, "POST", `/api/v1/projects/${pid}/commits`, {
    request_id: crypto.randomUUID(),
    expected_revision: rev,
    client_label: "seed-deep",
    summary: "e2e 三层骨架：A → B → C",
    operations: [
      { op: "node.create", id: a, parent_id: null, kind: "question",
        title: "三层A：一级路线", summary: "根问句", status: "in_progress" },
      { op: "node.create", id: b, parent_id: a, kind: "idea",
        title: "三层B：二级子路线", summary: "承上启下", status: "in_progress" },
      { op: "node.create", id: c, parent_id: b, kind: "attempt",
        title: "三层C：三级尝试", summary: "应默认隐藏", status: "unexplored" },
    ],
  });
  expect(r.status, JSON.stringify(r.json)).toBe(200);
  return { pid, a, b, c, name };
}

export async function enterStudio(page, pid: string, node?: string) {
  await page.goto(`/p/${pid}${node ? `?node=${node}` : ""}`);
  await expect(page.getByText("ResearchMap").first()).toBeVisible();
  await page.getByPlaceholder("访问令牌（Bearer token）").fill(TOKEN);
  await page.getByRole("button", { name: "打开" }).click();
  await expect(page.locator("select")).toHaveValue(pid);
}
