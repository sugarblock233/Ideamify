# 第二轮验收整改结果 — ResearchMap（Ideamify）2026-09-14

本文件对应**第二轮**审查报告 `docs/acceptance-2026-09-14/REPORT.md`（下称"报告"）。
报告的条件是"逐项修复并用真实命令/截图重新验证"，并明确驳回了第一轮"已修复且验证"的结论：
第一轮把"编译通过/文件就绪"当成"浏览器验证通过"，其中 3 个 P1 产品缺陷在真实环境可复现。
因此本文件**不再沿用第一轮的自评**：每一条 R 项都给出本轮真实执行过的复现命令与实测结果；
未跑过的（尤其容器与远端 CI）一律写"未验证/待远端权限"，不写"本地等价物全绿"。

状态只使用五种：**已修复且验证／已实现未验证／待所有者决定／待远端权限／未完成**。

> 说明：`docs/acceptance-2026-09-1{3,4}/`（含本轮报告与用户原件）保持 **untracked、未提交**；
> 本文件是仓库内唯一对外的整改记录。

---

## 1. 运行环境与数据隔离

| 项 | 值 |
|---|---|
| 系统 | macOS Darwin 25.6.0（本地）；CI 基线 ubuntu-latest / Node 22 / Python 3.13 |
| 本地 Node | v24.10.0（**与 CI 基线 22 不同**，未消差；见 §6-1） |
| Python | 3.13.5（`backend/.venv`） |
| 浏览器 | Playwright Chromium（headless，本机缓存） |
| E2E 服务器 | 生产形同源：`uvicorn app.main:app` + 预构建 `dist/`，127.0.0.1:8021，库为每次新建的 `mktemp -d` scratch |
| 压测读数服务器 | 127.0.0.1:8126（对 `/tmp/rm-stress/data.db`，1104 节点 / 3000 关系） |
| 数据库 | 全部为临时合成库：`E2E_DB_DIR=$(mktemp -d)`、`/tmp/rm-stress`、`/tmp/rm-smoke*`。交付前清理 |
| 真实数据 | **未触碰**。所有写入都指向临时库；令牌全为合成值（`e2e-*`/`e2e-other-*`/`researcher-*`/`stress-*`） |
| 提交署名 | 本轮 12 个提交**不带** `Co-Authored-By` 尾注（遵守本仓 `AGENTS.md:94`）；存量 15 个提交的尾注冲突见 §3-9 |

---

## 2. 本轮逐项结果（R01–R10）

| 项 | 状态 | 提交 | 复现命令 / 场景 | 实际结果 | 剩余限制 |
|---|---|---|---|---|---|
| **R01** 退出不确认导致草稿丢失 | 已修复且验证 | `8faf081` | `E2E_DB_DIR=$(mktemp -d) npx playwright test e2e/collab.spec.ts -g "离开确认"` | 统一 `confirmLeaveDraft()` 后，「退出」与「+ 项目」两条真正的离开路径都先弹确认；取消 → 留在原项目、草稿逐字不变、不弹建项目弹窗；确认 → 回到令牌闸门。同一 e2e 用例覆盖三个分支 | 「切换节点/关闭面板」沿用原有 `guardLeave` 文案，未额外重复断言（同一函数） |
| **R02** 同字段冲突缺三方比较 + 刷新静默吞冲突 | 已修复且验证 | `8faf081`、`e13738c` | ① `npx vitest run src/lib/__tests__/merge.test.ts`（11 用例）② `npx playwright test e2e/collab.spec.ts -g "A02 同字段并发"` ③ 同文件 `-g "syncAll"` | 409 后逐字段展示 **读取时 / 你的草稿 / 服务器** 三栏 + 「保留我的／采用服务器／我自己合并」；未处理时「保存」禁用。**本轮新发现的同类缺陷**：提交成功后的 `syncAll` 会按新基线重新合并，于是"用户看过但没答复"的冲突不再像冲突 —— 列表被静默清空、保存重新可用，一键即覆盖队友提交。新增 `preserveUndecided()` 保留未处理项（服务器列刷新为当前值），并新增 e2e 走真实可达路径：编辑 → 他人提交 → 载入更新出现三方比较 → 做一次无关的成功提交（触发 syncAll）→ 冲突仍在。**反向验证**：把 `preserveUndecided` 的未处理项参数置空并重新构建 → 该用例在第 411 行 `toHaveCount(1)` 收到 0 而失败；恢复后通过 | 「载入更新」的触发在 e2e 中由派发真实 `focus` 事件驱动（等价于用户切窗回来），未等 20s 轮询 |
| **R03** 大图首屏不可读 + MiniMap 空白 | 已修复且验证 | `c87ef82`、`bab84f5`、`fbbeb8a` | `python3 scripts/stress_test.py` 造 1104 节点库 → 8126 起全形 uvicorn → `cd frontend && RESEARCHMAP_BASE_URL=http://127.0.0.1:8126 RESEARCHMAP_TOKEN=stress-token-0001 node ../scripts/measure_firstopen.mjs <pid> 1440 900`（脚本已入库） | 放弃"整体包围盒硬 fit + 0.4 地板"，改为**锚定根节点 + 固定可读缩放 0.7**。1104 节点实测（本轮构建）：zoom **0.7**（报告基线 0.4）、卡片渲染宽 **196px**（基线 112px）、标题渲染字号 **9.8px**（基线 ≈5.6px）、1440×900 **8 张卡完整入屏**（1280×800 为 7 张）、首卡 274–357ms、104 卡 / 104 个折叠徽标。截图 `docs/evidence/a03-stress-1104-firstopen-{1440x900,1280x800}.png` 目视为可读。MiniMap：查得真因是**受控 `nodes` 未写 `node.measured`**（未传 `onNodesChange`），补 `width`/`height` 后恢复渲染；实测右下角已画出节点与视口矩形（1104 节点图是单列长条，故形态退化为一条竖线，不是空白） | 「首屏可读」由脚本读数 + 截图目视确认，未做 OCR 级断言；大图 e2e 用 50×2 节点小图断言卡宽阈值（快、稳），1104 级读数靠上表脚本 |
| **R04** E2E 未全绿（10 passed / 2 failed） | 已修复且验证 | `966fc0f`、本轮新增用例 | `E2E_DB_DIR=$(mktemp -d) npx playwright test`（连续三次全新库） | 报告的两个失败根因均已按 R04 禁令修掉（不用 force click / 不加 timeout / 不跳过）：① `collab.spec.ts` 的 `getByText("三层C")` 同时命中卡片、面包屑与 `h2` → 改为按容器限定（`.rm-card` / `h2`）；② `acceptance.spec.ts` 的右键不稳定 → 改为先 `toBeInViewport()` 再操作。结果：**19/19**，三次连跑 18.0s / 17.3s / 17.9s 全绿 | **残余不稳定（如实记录）**：本轮中间状态曾出现 **1 次** `A07 节点深链接` 偶发失败（当时报错文本未留存）；随后 43 次全量/单文件连跑（均全新库）没有再复现。未按"加大 timeout"掩盖，标记为**已知残余风险**；补验：CI 连续 20 次绿后撤销该标记 |
| **R05** 最终 context 可能超字符预算 | 已修复且验证 | `74a03f6` | `backend/.venv/bin/python -m pytest backend/tests -q`；明细见 `backend/tests/api_smoke.py` 的 A04-a/b/c 三段 | 预算检查移到**所有元数据（warnings/continuations/omitted_counts）写完之后**并对最终响应体重测：`A04-a: focus@4000 final size within budget`（compact ≤ 4000 且 meta 非空）、`A04-b` 省略项 → `truncated=true`、`A04-c` 唯一 q 命中优先、`context over-budget required-skeleton -> 422 CONTEXT_BUDGET_TOO_SMALL` | 无 |
| **R06** 便捷模式首次失败 stderr 不是单个合法 JSON | 已修复且验证 | `107399e` | `backend/tests/test_cli.py::test_first_failure_after_identity_writeback_is_one_json_object`（真实起 scratch 服务器） | 身份回写提示改为**缓冲**：成功后才打印，失败时并入同一个错误对象（`notes` 字段）。该用例断言"文件被回写身份字段后 POST 故意失败"时 stderr 整体可 `json.loads` 为**恰好一个**对象 | 交互式真人手敲路径未逐条重放（用例走的是同一 CLI 入口） |
| **R07** Markdown context 丢字段 + 无 data_notice | 已修复且验证 | `107399e` | `backend/tests/test_cli.py::test_markdown_keeps_analysis_fields_of_every_item`、`::test_markdown_keeps_notice_truncation_and_continuations` | 抽出的 `_append_analysis_fields()` 现在对 `related_nodes`/`prior_attempts`/`open_nodes`/`routes`/`recent_findings`/`matched` 的**每一条**也打印 scope/finding/decision（存在才打印），并在 markdown 输出补 `data_notice`；截断标记与续读指引保持 | `--max-chars` 只约束底层 JSON、markdown 是纯渲染 —— 已写入文档而不是改行为 |
| **R08** 不可执行/错误的契约文案 | 已修复且验证 | `1f2609e` | README 命令逐条真跑：`python3 tools/backup.py backup --db … --out …` → `python3 tools/backup.py verify ./backup/researchmap-<ts>.db` | ①`verify` 用法改为位置参数（`--db` 形式复现为 exit 2 `unrecognized arguments`，改后真实跑通）；②`AI_USAGE.zh-CN.md` 的 `--dry-run` 说明已改为实情（"只让服务端不落库；若提交文件缺 `request_id`/`expected_revision`，CLI 在任何模式下都会回写"）；③AI 接入弹窗改为可直接粘贴的命令（给出真实项目 id，去掉 `[--foo <占位>]` 伪语法），409 说明点明四种 code（`REVISION_CONFLICT` 锁的是**整个项目的版本**，非"同一对象"） | 弹窗文案由 e2e「B06」逐字断言关键片段（四种 code 全列、真实 pid、无方括号占位） |
| **R09** `implementation-results.md` 与实况不符 | 已修复且验证 | 本文件 | 逐条对照仓库实况复核 | 全篇重写；第一轮的错误结论在 §3 逐条更正（含 E2E 数字、容器 job、模板数量、不存在的 `WORKSPACE.md`/`PROTOCOL.md`） | 远端状态类条目一律标"未验证/待所有者操作" |
| **R10** GitHub 维护约定未完成项 | 部分已修复且验证 / 部分待远端权限 | `f9d9844`、`f9e07e7` | ①`grep -n "uses:" .github/workflows/ci.yml` ②本地跑 credential-scan 片段（含假凭证的临时文件）③`git log` 审署名 | ①4 个 action 全部钉到**经 API 核对**的 40 位 SHA + 版本注释（checkout v4.4.0、setup-node v4.4.0、setup-python v5.6.0、upload-artifact v4.6.2）；②credential-scan 改为**只报"文件:行号"**，日志不再回显匹配文本（假凭证实测：日志只出现路径与行号）；③`markdown-link-check` 文件列表补上 `docs/AI_USAGE.zh-CN.md`；④本轮提交不再带 `Co-Authored-By` | **远端未跑**：Actions 从未在远端执行过（本地无 push 授权）→ 待远端权限。存量 15 个提交的尾注未改写（改写历史属所有者决定，见 §3-9） |

---

## 3. 对第一轮文档错误结论的更正

以下每条都是报告指出、本轮逐条核实的**事实性错误**，已在 §2/本文件中纠正（不新增文件、不虚构内容）：

1. **E2E 通过数**：第一轮写 "e2e 12/12"。第二轮报告在真实浏览器环境复现为 **10 passed / 2 failed**。本轮修完定位器与操作方式后为 **19/19（5 个文件）**，连续三次全新库全绿。
2. **后端用例数**：第一轮写 "api_smoke 88/88"。本轮补充 B04/R05 相关检查后为 **93/93**（`pytest` 入口 6 passed，包裹该脚本）。
3. **前端单测数**：第一轮写 37/37。本轮为 **48 passed（6 文件）**（新增冲突保留、markdown、关系等）。
4. **G05 容器 job**：第一轮写"五 job 的本地等价全部绿"。事实：本机**没有 Docker**（无 CLI、无 docker.sock），**container job 从未在本地或以任何形式跑过** → 现标 **待远端权限**，不得以其它 job 的绿替代。
5. **G03 Issue 模板数量**：第一轮写"三模板"。仓库实际为 `bug_report.yml` + `feature_request.yml`（外加 `config.yml` 选择器），**没有第三个模板**；本文件不再声称存在，也不为凑数新增。
6. **G09 文件职责**：第一轮写有 `WORKSPACE.md` 与 `PROTOCOL.md`。**这两个文件在仓库中不存在**（`ci.yml` 的文件列表与仓库实际文件都没有）。已删除该声称，不新造文件。
7. **A03 的口径**：第一轮把 1100+ 规模首开 zoom 0.4（卡宽 ≈112px、文字 ≈5px）记为"设计取舍"。报告要求改为"**折叠通过、可读性未通过**"。本轮按 R03 修复后重测 **0.7 / 196px / 9.8px**，故 A03 现为**已修复且验证**（§2 R03）。
8. **MiniMap"空白"**：第一轮记为"大图下的已知限制/待改进"。本轮定位到真因（受控 nodes 未写 measured）并修复、截图佐证。
9. **署名与 `AGENTS.md` 冲突**：存量 **15 个**提交（第一轮 14 个 + `1c5677e`）带 `Co-Authored-By: Claude` 尾注，与本仓 `AGENTS.md:94`"AI 工具不得列为作者"冲突。本轮 12 个提交已遵守该约定（无尾注）；**改写存量历史属所有者决定**（已 push/共享风险），本交付不擅自 `rebase`/`filter-branch`。
10. **远端状态**：topics / description / ruleset / 可见性 / tag / 依赖告警等**没有任何实际读取证据**，一律标"未验证/待所有者操作"，不写成"已配置"。

---

## 4. 测试与门禁实测（本轮最终提交、全新数据）

| 关卡 | 命令 | 结果 |
|---|---|---|
| 类型检查 | `cd frontend && npx tsc --noEmit` | **0 错误** |
| 前端单测 | `npm run test`（vitest） | **48 passed / 6 files** |
| 前端构建 | `npm run build` | 成功（仅 chunk 体积告警） |
| 后端 | `backend/.venv/bin/python -m pytest backend/tests -q` | **6 passed**（包裹 `api_smoke` 93/93 + 5 个 CLI 契约用例） |
| API 冒烟明细 | `RESEARCHMAP_DB=… RESEARCHMAP_TOKENS='{"researcher":"…","ai-sim":"…"}' backend/.venv/bin/python backend/tests/api_smoke.py` | **93/93 passed** |
| E2E（浏览器，生产形） | `cd frontend && E2E_DB_DIR=$(mktemp -d) npx playwright test` | **19 passed**，连跑三次：18.0s / 17.3s / 17.9s |
| 压测读数 | `scripts/measure_firstopen.mjs`（见 §7） | 1104 节点：zoom 0.7 / 卡宽 196px / 标题 9.8px / 8 卡完整入屏 |
| CI（远端） | — | **未运行**（无 push 授权）→ 待远端权限 |
| CI 配置静态核对 | `uses:` SHA 格式、YAML 结构、credential-scan 假凭证试跑 | 通过（本地） |

E2E 19 条清单见 §7。`acceptance.spec.ts` 的"空库"用例在库非空时自动 skip 并提示 `E2E_DB_DIR=$(mktemp -d)` 单跑（合法设计，未删除）；本轮所有全量跑都用了全新 scratch 库，不存在"跳过被当成通过"。

> 环境注记：本轮最后一次全量跑时，本机 8021 端口被一个**已退出进程遗留的监听套接字**占住
> （`netstat` 显示 LISTEN，但 `lsof` 查不到属主进程，也无法释放）。为完成验证，这次运行临时把
> `playwright.config.ts` 与各 spec 的端口改为 8023，跑完（19/19）后已 `git checkout` 还原为 8021。
> 这是本地环境现象，与仓库代码无关；仓库内端口仍是 8021。

---

## 5. G10 — 所有者决定（第一部分已落实）

| # | 事项 | 状态 | 事实 |
|---|---|---|---|
| 1 | LICENSE 与版权 | **已决定并落实** | `LICENSE` = MIT，版权人 `sugarblock233`；README/README.zh-CN 徽章与文字同步 |
| 2 | 安全通报渠道 | **已决定并落实** | `SECURITY.md` 指向 **GitHub Issues / Discussions**（仓库内唯一的联系渠道，未编造邮箱或 SLA） |
| 3 | 项目名 | **已决定并落实** | 最终名 **Ideamify**（应用名 ResearchMap），README/package.json/页面标题一致 |
| 4 | Docker / Windows 11 验证 | **所有者明确推迟** | 本轮不做，不阻塞；D01/D02 保持"已实现未验证"，D03 保持"未完成" |
| 5 | push / tag / 发布 / 可见性 | **待所有者操作** | 本轮**未 push、未打 tag、未发布、未改可见性**；首次发布文案在 `CHANGELOG.md` Unreleased |
| 6 | 远端仓库设置（topics/description/ruleset/安全特性） | **待所有者操作** | 本地无法读取或修改，未验证 |
| 7 | 存量 15 个提交的 `Co-Authored-By` 尾注 | **待所有者决定** | 改写历史是共享风险操作，本交付只记录不动手 |

---

## 6. 未验证项与补验步骤（诚实清单）

1. **CI 远端全绿（含 container job）** — 待远端权限。补验：Owner 授权 push → 观察 5 个 job（frontend / backend / container / checks）→ 全绿后本行改判。
2. **D01/D02/D03 容器行为** — 本机无 Docker。补验：CI container job 跑通（build + `/healthz` + 默认无令牌 401）+ 一次备份/恢复演练。
3. **本地 Node 24.10.0 与 CI 基线 22 的差异** — 未消差。补验：CI 首次绿即视为消差。
4. **A07 深链接的 1 次偶发失败** — 未定位（报错文本未留存），此后 43 次连跑未复现。补验：CI 连续 20 次全绿后撤销"残余风险"标记。
5. **B04 其它浏览器分支**（上移/同级排序/环防护/历史翻页）— 本轮只补验了报告点名的"归档→恢复"往返（并因此发现并修复了真实缺陷，见下），其余分支仍只有后端语义覆盖。补验：4 个浏览器用例。
6. **A03 的极小/极大视口**（400px、4K）— 只有 1440×900 与 1280×800 两张读数。补验：各加一张截图。
7. **远端仓库状态类声明**（topics/ruleset/告警）— 未验证。

### 本轮计划外发现并修复的缺陷

- **B04 归档后无法在浏览器恢复**（报告只要求"补验"）：后端 `graph` 默认过滤归档节点、搜索同样过滤，而前端**没有任何恢复入口**（`SidePanel` 的 `onRestore` 只连了 props 未渲染）——归档即不可逆。修复：`graph?include_archived=true`、顶栏 ⋯「显示/隐藏已归档节点」开关（跨提交同步保持）、画布归档卡样式 + 「已归档」标记、详情面板「恢复此节点」+ 必填原因。提交 `f9a7b5a`，e2e `bab84f5`。**反向验证**：仅回退 `SidePanel.tsx` 时用例停在等待「恢复此节点」按钮，证明缺失入口就是缺陷本身。
- **R02 的 syncAll 变体**（见 §2 R02）：未处理的冲突会被后续任意一次成功提交静默清掉。修复 `e13738c`，含单元测试 5 条与一条真实路径 e2e。

---

## 7. 证据文件与复现命令

### 证据文件（均在仓库内，可逐张查看）

| 文件 | 说明 |
|---|---|
| `docs/images/workspace-1440x900.png` | README：工作区（合成数据，页面内有声明） |
| `docs/images/detail-panel-1280x800.png` | README：详情阅读视图 |
| `docs/evidence/a03-stress-1104-firstopen-1440x900.png` | **R03 关键证据**：1104 节点项目首开，zoom 0.7、卡宽 196px |
| `docs/evidence/a03-stress-1104-firstopen-1280x800.png` | 同上，1280×800 |
| `docs/evidence/a03-firstopen-1440x900.png`、`a03-firstopen-1280x800.png` | 大图 e2e 用例再生（小图断言卡宽阈值） |
| `docs/evidence/a03-branch-expanded-1440x900.png` | 分支视图：只看这一分支 → 展开此分支 |

### 复现命令

```bash
# 前端：类型检查 + 单测 + 构建（48 用例）
cd frontend && npm ci && npm run build && npm run test && npx tsc --noEmit

# 后端：pytest 包裹 api_smoke（93/93）+ CLI 契约用例（共 6 用例）
backend/.venv/bin/python -m pytest backend/tests -q

# E2E 全量（19 用例 / 5 文件；务必用全新 scratch 库）
cd frontend && E2E_DB_DIR=$(mktemp -d) npx playwright test

# 单跑需要空库的验收用例
cd frontend && E2E_DB_DIR=$(mktemp -d) npx playwright test e2e/acceptance.spec.ts

# R03 大图读数（1104 节点；自带合成数据，脚本安全）
python3 scripts/stress_test.py
RESEARCHMAP_STATIC=$PWD/frontend/dist RESEARCHMAP_DB=/tmp/rm-stress/data.db \
  RESEARCHMAP_TOKENS='{"stress":"stress-token-0001"}' \
  backend/.venv/bin/python -m uvicorn app.main:app --app-dir backend --host 127.0.0.1 --port 8126
cd frontend && RESEARCHMAP_BASE_URL=http://127.0.0.1:8126 RESEARCHMAP_TOKEN=stress-token-0001 \
  node ../scripts/measure_firstopen.mjs <project_id> 1440 900

# R08：README 里的备份/校验命令真跑
python3 tools/backup.py backup --db <scratch.db> --out /tmp/rm-bk
python3 tools/backup.py verify /tmp/rm-bk/researchmap-<ts>.db
```

### E2E 用例清单（19）

```
acceptance.spec.ts  A01 空库全流程；A08 外部更新提示→稍后→手动刷新
bigmap.spec.ts      A03/R03 大图首屏（1440×900）；A03/R03 大图首屏（1280×800）；A03/R03 分支视图往返
collab.spec.ts      A03 首次打开三层折叠；A03 折叠往返；A07 深链接；A02 离开确认（R01）；
                    B06 AI 接入说明；A02 同字段并发 409→重排→保存；B04 归档→恢复往返；
                    R02 提交后自动刷新不得静默清冲突
screenshots.spec.ts 主树画布 + 跨分支关联；节点详情阅读视图
smoke.spec.ts       深链接+令牌闸门；错误令牌被拒；选中出详情；仅叶子可归档
```

---

## 8. 交付清单与结论

- **未 push / 未打 tag / 未发布 / 未改可见性**（`git log` 仅本地提交）。
- **§10 延后项未实现**（自动发版、CLA、机器人、i18n、demo 站、CITATION/DOI、多平台镜像）。
- **真实数据库未触碰**：全部验证走临时库与临时端口；仓库内无 `*.db` 被跟踪。
- **用户原件未入库**：`docs/acceptance-2026-09-1{3,4}/` 保持 untracked。
- **临时资源已清理**：scratch 服务器终止，`/tmp/rm-*` 删除。
- **状态小结**：R01–R09 **已修复且验证**；R10 **部分已修复且验证**（CI 文件与署名），其"远端跑一次"部分 **待远端权限**；D01/D02 **已实现未验证**、D03 **未完成**（所有者已明确推迟）。

**结论：本地实施完成；发布仍待这些事项** —— ① 所有者授权 push 并由远端 CI 跑绿（含容器 job）；② 所有者决定存量 15 个提交尾注是否改写；③ 远端仓库设置（topics/description/ruleset/安全特性）与首次 tag/发布；④ 容器与 Windows 11 验证（所有者已推迟）。