#!/usr/bin/env node
/** 容器部署的真实浏览器演练（D01–D03 的可复现证据，不是测试）。
 *
 * 对着一个**已经在跑的容器**（compose 起的生产形同源部署）走一遍用户真正会
 * 走的路径：打开 /p/<pid> → 过令牌闸门 → 画布出卡片 → 深链接 ?node=<id>
 * 自动展开并选中 → 详情面板可读。并截图。
 *
 * 用法（令牌用容器启动时注入的那个合成值）：
 *   RESEARCHMAP_BASE_URL=http://127.0.0.1:8022 \
 *   RESEARCHMAP_TOKEN=container-token-0001 \
 *   RESEARCHMAP_SHOT=/tmp/rm-d03/container.png \
 *     node scripts/verify_container.mjs
 *
 * 不传 pid 时从 GET /api/v1/projects 自取第一个项目。全部为合成演练数据。
 */

import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

// playwright 解析自 frontend/node_modules（本脚本不在其作用域内）。
const HERE = path.dirname(fileURLToPath(import.meta.url));
const frontendRequire = createRequire(path.join(HERE, "..", "frontend", "package.json"));
const { chromium } = frontendRequire("@playwright/test");

const BASE = process.env.RESEARCHMAP_BASE_URL ?? "http://127.0.0.1:8000";
const TOKEN = process.env.RESEARCHMAP_TOKEN;
const SHOT = process.env.RESEARCHMAP_SHOT;
if (!TOKEN) {
  console.error("需设置 RESEARCHMAP_TOKEN（容器启动时注入的合成令牌）");
  process.exit(2);
}

const api = async (p) => {
  const r = await fetch(`${BASE}${p}`, { headers: { Authorization: `Bearer ${TOKEN}` } });
  if (!r.ok) throw new Error(`${p} → ${r.status}`);
  return r.json();
};

const pid = process.argv[2] ?? (await api("/api/v1/projects")).items[0]?.id;
if (!pid) throw new Error("没有项目可演练");
const graph = await api(`/api/v1/projects/${pid}/graph`);
const rootId = graph.nodes.find((n) => !n.parent_id)?.id ?? graph.nodes[0]?.id;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));

// ① 普通路径：令牌闸门 → 画布
await page.goto(`${BASE}/p/${pid}`);
await page.getByPlaceholder("访问令牌（Bearer token）").fill(TOKEN);
await page.getByRole("button", { name: "打开" }).click();
await page.locator(".rm-card").first().waitFor({ timeout: 60_000 });
const cards = await page.locator(".rm-card").count();

// ② 深链接：?node=<root> 自动展开并选中
await page.goto(`${BASE}/p/${pid}?node=${rootId}`);
await page.getByPlaceholder("访问令牌（Bearer token）").fill(TOKEN);
await page.getByRole("button", { name: "打开" }).click();
await page.locator(".rm-card").first().waitFor({ timeout: 60_000 });
const detail = page.locator(".readsec, .panel-right, h2").first();
await detail.waitFor({ timeout: 30_000 });

const report = {
  base: BASE,
  project: pid,
  revision: (await api(`/api/v1/projects/${pid}`)).revision,
  nodes: graph.nodes.length,
  cardsOnCanvas: cards,
  detailVisible: await detail.isVisible(),
  consoleErrors: errors,
  shot: SHOT ?? null,
};
console.log(JSON.stringify(report, null, 2));
if (SHOT) {
  await page.screenshot({ path: SHOT });
  console.log(`截图：${SHOT}`);
}
await browser.close();
if (errors.length) process.exit(1);