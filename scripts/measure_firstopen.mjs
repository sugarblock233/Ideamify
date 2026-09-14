#!/usr/bin/env node
/** 首屏可读性读数（A03/R03 的可复现证据，不是测试）。
 *
 * 用真实 Chromium 打开一个项目，报告首屏（无已存视图）落在什么缩放上、
 * 卡片渲染宽度、标题实际字号、有多少张卡完整入屏，并截图。
 *
 * 用法：
 *   # 1) 造一个 1104 节点项目（自带 scratch 服务器，安全）
 *   python3 scripts/stress_test.py
 *   # 2) 对着那份库起全形 uvicorn（合成令牌）
 *   RESEARCHMAP_STATIC=$PWD/frontend/dist \
 *   RESEARCHMAP_DB=/tmp/rm-stress/data.db \
 *   RESEARCHMAP_TOKENS='{"stress":"stress-token-0001"}' \
 *   backend/.venv/bin/python -m uvicorn app.main:app \
 *     --app-dir backend --host 127.0.0.1 --port 8126
 *   # 3) 读数（项目 id 从 GET /api/v1/projects 取）
 *   cd frontend && RESEARCHMAP_BASE_URL=http://127.0.0.1:8126 \
 *   RESEARCHMAP_TOKEN=stress-token-0001 \
 *     node ../scripts/measure_firstopen.mjs <project_id> 1440 900
 *
 * 需要 frontend/node_modules 里的 playwright（本脚本从 frontend/ 运行）。
 * 全部数据都是合成压测数据；本脚本不写任何研究数据。
 */

import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

// 从仓库根的 frontend/ 解析 playwright（本脚本自己不在 node_modules 的作用域里）。
const HERE = path.dirname(fileURLToPath(import.meta.url));
const frontendRequire = createRequire(path.join(HERE, "..", "frontend", "package.json"));
const { chromium } = frontendRequire("@playwright/test");

const BASE = process.env.RESEARCHMAP_BASE_URL ?? "http://127.0.0.1:8000";
const TOKEN = process.env.RESEARCHMAP_TOKEN;
const [pid, wArg, hArg] = process.argv.slice(2);
const W = Number(wArg ?? 1440);
const H = Number(hArg ?? 900);

if (!pid || !TOKEN) {
  console.error("用法：RESEARCHMAP_BASE_URL=… RESEARCHMAP_TOKEN=… node measure_firstopen.mjs <project_id> [w] [h]");
  process.exit(2);
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: W, height: H } });
const t0 = Date.now();
await page.goto(`${BASE}/p/${pid}`);
await page.getByPlaceholder("访问令牌（Bearer token）").fill(TOKEN);
await page.getByRole("button", { name: "打开" }).click();
await page.locator(".rm-card").first().waitFor({ timeout: 60_000 });
const firstCardMs = Date.now() - t0;

const pane = await page.locator(".canvas-wrap").boundingBox();
const cards = await page.locator(".rm-card").evaluateAll((els) =>
  els.map((e) => {
    const r = e.getBoundingClientRect();
    return {
      title: e.querySelector(".title")?.textContent ?? "",
      folded: !!e.querySelector(".fold-btn"),
      archived: e.classList.contains("archived"),
      x: r.x, y: r.y, w: r.width, h: r.height,
    };
  }),
);
const shown = (c) =>
  c.x + c.w > pane.x && c.x < pane.x + pane.width && c.y + c.h > pane.y && c.y < pane.y + pane.height;
const whole = (c) =>
  c.x >= pane.x && c.x + c.w <= pane.x + pane.width + 1 &&
  c.y >= pane.y && c.y + c.h <= pane.y + pane.height + 1;
const zoom = await page.evaluate(() => {
  const vp = document.querySelector(".react-flow__viewport");
  return new DOMMatrixReadOnly(getComputedStyle(vp).transform).a;
});
const titleFontPx = await page
  .locator(".rm-card .title")
  .first()
  .evaluate((e) => parseFloat(getComputedStyle(e).fontSize_ ?? getComputedStyle(e).fontSize));

const out = {
  viewport: `${W}x${H}`,
  firstCardMs,
  totalCards: cards.length,
  cardsInPane: cards.filter(shown).length,
  cardsWhollyInPane: cards.filter(whole).length,
  zoom,
  cardWidthPx: Math.round(cards[0].w * 10) / 10,
  titleFontPx,
  renderedTitleFontPx: Math.round(titleFontPx * zoom * 10) / 10,
  foldBadges: cards.filter((c) => c.folded).length,
  archivedCards: cards.filter((c) => c.archived).length,
  inPaneTitles: cards.filter(shown).map((c) => c.title),
};
console.log(JSON.stringify(out, null, 2));
const shot = process.env.RESEARCHMAP_SHOT ?? `/tmp/firstopen-${W}x${H}.png`;
await page.screenshot({ path: shot });
console.log(`截图：${shot}`);
await browser.close();