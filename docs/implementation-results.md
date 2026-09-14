# 实施结果 — ResearchMap（Ideamify）2026-09-14 验收缺陷修复

对齐 `docs/QWEN_EXECUTION_PLAN.md`（下称"计划"）逐条执行。状态只使用计划允许的五种：
**已修复且验证／已实现未验证／待所有者决定／待远端权限／未完成**。
"验证"一律指真实执行（真实命令/真实浏览器/真实压测），不以编译通过或文件就绪替代；
未验证项在每个状态中都给出**剩余限制 + 可执行的补验步骤**。

---

## 1. 运行环境与数据隔离

| 项 | 值 |
|---|---|
| 系统 | macOS Darwin 25.6.0（本地）；CI/Docker 基线 Node 22 / Python 3.13 |
| 本地 Node | v24.10.0（**与 CI 基线 22 不同**，补验：CI 跑绿一次即消差） |
| Python | 3.13.5（`backend/.venv`） |
| 浏览器 | Playwright Chromium headless（本机缓存） |
| E2E 服务器 | 全生产形：`uvicorn app.main:app` + 预构建 `dist/`，127.0.0.1:8021 |
| 压测服务器 | 127.0.0.1:8125（scripts/stress_test.py，已销毁） |
| CLI 验证服务器 | 127.0.0.1:8031（已销毁） |
| 大图读数服务器 | 127.0.0.1:8126（对着压测库的全形 uvicorn；布局计时用 Node 原生 TS 直跑，未装任何新依赖；已销毁） |
| 数据库 | 全部临时合成库：`/tmp/rm-e2e`（e2e 默认）、`/tmp/rm-acc*`（手动）、`/tmp/rm-stress/data.db`（1104 节点压测库）、`/tmp/rm-cli-verify`。**均已在交付前清理** |
| 真实数据 | **未触碰**。所有验证写入都指向 mktemp/临时库，令牌全部为合成值（`e2e-*`、`researcher-*`、`ai-sim-*`、`stress-*`） |

---

## 2. 逐条结果总表

### A 组 — 核心缺陷（P1）

| 任务 ID | 状态 | 实现文件/提交 | 验证命令或场景 | 实际结果/证据 | 剩余限制 |
|---|---|---|---|---|---|
| A01 空库首次创建 | 已修复且验证 | `frontend/src/App.tsx`（空状态创建表单/进入列表）；批次 `fix(onboarding): …(A01)` | 全新 scratch 库浏览器全流程：`E2E_DB_DIR=$(mktemp -d) npx playwright test e2e/acceptance.spec.ts` | 空库显示"还没有可用的项目"→ 浏览器内创建首个项目（项目 id 服务器生成）→ 两条一级路线 → 子节点 → 编辑保存 → 整页刷新 → 重登后内容与服务器一致（graph 3 节点、子节点摘要逐字一致） | 无（核心验收链路全部完成） |
| A02 并发写 409 草稿失步 | 已修复且验证 | `frontend/src/workspace/Workspace.tsx`（草稿基线钉住 draftBaseRev / rebaseDraft / threeWayMerge）；批次 `fix(workspace): …(A02/A08)` | e2e collab A02：同字段冲突 → 保留草稿 → 载入新版并重排 → 保存 | 409 后草稿不丢、冲突字段提示"已保留你的值"、保存成功；服务端复核最终 summary === 本地、revision === seed+2 | "载入重排后对方再次推进→取消离开草稿仍不丢"完整矩阵未 e2e 化（后端 200/409 双写互斥已由 api_smoke 88/88 覆盖）；补验：e2e 追加一次 rebase 后取消离开 |
| A03 大图默认不可读 | 已修复且验证 | `frontend/src/lib/layout.ts`（initialFolds/computeLayout）、`Canvas.tsx`（锚定重布局）、`__tests__/initialFolds.test.ts`、`layout.stress.test.ts`；批次 `fix(canvas): …(A03/B03)` | ① `cd frontend && npm run build && npm run test`（单测 5+3）② 1104 节点压测项目浏览器读数（headless Chromium，1440×900 与 1280×800） | 纯 computeLayout：全树 **0.81ms** / 默认两级 **0.43ms**（Node 直跑 fixture，7 次取中位）；浏览器首开 **244/245ms**（令牌→首卡），**104 业务卡**（4 一级 + 100 二级）、**100 个 +10 折叠徽标**、首开 zoom 0.4；点选中心卡详情面板出现；搜索"压力节点 0550" 2.9s 选中且详情正确；右键"只看这一分支"（保留折叠 → 1 卡）→"展开此分支"→ **11 卡**（1+10，含红态节点高亮）；单测无重叠/无间隙/确定性全过；截图 3 张入库 `docs/evidence/` | 1100+ 规模首开 zoom 0.4（卡宽约 112px，文字≈5px）：结构清晰而字符非读取级——设计取舍（104 卡可读缩放位需约 39000px 布景，不选 fit-all）；导航主轴为搜索/分支视图/缩放。未程序化断言 1100 级画布的全程缩放平移遍历；补验：浏览器内对该分支做 0.5×→2.4× 缩放视觉走查一次并人工确认 |
| A04 context 预算不是最终值 | 已修复且验证 | `backend/app/context.py`、`backend/app/views.py`；批次 `fix(context): …(A04)` | `backend/.venv/bin/python -m pytest tests/ -q`（包裹 api_smoke 88/88） | A04-a focus@4000 在最终预算内且 meta 非空；A04-b 省略场景 `truncated=true` + `omitted_counts` + `data_notice`（声明合成数据）；A04-c q 匹配优先；预算 <4000 → 422 `CONTEXT_BUDGET_TOO_SMALL`（返回最小所需值） | 无 |
| A05 CLI 契约/重试身份 | 已修复且验证 | `tools/researchmap.py`；批次 `fix(cli): …(A05)` | scratch 服务器 10 项实测（临时脚本 10/10，已清理；命令序列见 §6 附录） | session 身份 researcher；create-project `--file` 幂等重放（仅 1 项目）；便捷模式身份回写文件、重跑不双写；`--dry-run` 零状态变化；stale `expected_revision` → **exit 2 + stderr 单 JSON**（code=REVISION_CONFLICT） | DB_BUSY 路径需真实并发压力才触发，未人工复现（语义为"可重试"，代码与文档一致） |
| A06 红色/绿色节点证据闸口 | 已修复且验证 | `frontend/src/workspace/Workspace.tsx`（CreateNodeModal `.gated-fields`） | e2e acceptance A01 红色一级路线：红/绿状态 → 必填字段出现、未填不可提交 | 证据齐全一次成功创建；服务器侧 `graph.evidence_count===1` 与节点详情 `evidence` 长度 1（后端门槛未被前端绕过） | 无 |
| A07 深链接 | 已修复且验证 | `frontend/src/workspace/Workspace.tsx`（replaceDeepLink/深链初始化/祖先展开）+ `src/lib/deeplink.ts` | e2e collab A07（折叠祖先+深链）+ acceptance A01（刷新→重登录 URL 恢复） | `/p/<pid>?node=`：令牌绝不出现在 URL；节点在折叠分支内时自动展开祖先并选中；节点不存在 → toast 不崩；刷新后 URL 恢复 | 项目切换保持 URL、分支视图两个子场景未单独 e2e 化（代码路径有 toast 守卫）；补验：两个浏览器小场景各 1 例 |
| A08 外部更新自动载入 | 已修复且验证 | `Canvas.tsx`（提示框/稍后 chip）+ `Workspace.tsx`（tick/焦点检查/onManualRefresh） | e2e acceptance A08：外部提交 → 焦点事件触发检查 → 稍后 → 手动刷新 | 提示框"有新的记录 vN"**只提示不载入**；点"稍后"收起并留"待载入更新"标记，详情仍为旧值；点手动刷新才真正载入、标记消失 | "稍后"状态与编辑/草稿并存（提示不动草稿）未 e2e 化；代码审阅确认 tick 仅置 pendingRev、不触碰草稿引用；补验：编辑中收到提示→稍后→草稿未动 1 例 |
| A09 搜索框被挤 | 已修复且验证 | `TopBar.tsx`（单行布局 + ⋯ 菜单自关闭 menuRef）+ `styles.css`（搜索框 min-width） | 两视口截图断言（screenshots.spec）+ acceptance A01 真实搜索操作 | 长项目标题下搜索框可输入/可点击跳转；⋯ 菜单**首次点击即可关闭**（回归断言）；1440×900 与 1280×800 均可读 | 960/768/400 窄屏未实测截图（依赖换行）；补验：400px 宽度实测 1 张 |

### B 组 — 规范对齐

| 任务 ID | 状态 | 实现文件/提交 | 验证命令或场景 | 实际结果/证据 | 剩余限制 |
|---|---|---|---|---|---|
| B01 详情/关联/历史展示 | 已修复且验证 | `frontend/src/workspace/SidePanel.tsx` | e2e 详情流 + `docs/images/detail-panel-1280x800.png` + api_smoke 88/88（关联/历史服务端语义） | 详情区为以读为主（摘要/观察/结论/证据卡/关联 M/N/历史）；历史 20 条分页 + `after_id` 游标 | 全部浏览器子核对由截图 + 既有 e2e 覆盖而非逐场景断言；移动类操作未覆盖（属 B04） |
| B02 证据展示完整性 | 已修复且验证 | `SidePanel.tsx`（证据笔记卡：范围/发现/决定/证据条目） | 截图 + 详情 e2e | 红/绿节点完整显示三项关键证据 + 证据条目，无"关键证据留白" | 无 |
| B03 关系显示上限/M-N | 已修复且验证 | `Canvas.tsx`（虚拟根卡片边规范 + 关系 cap + "显示 M/N"条） | 两截图（分支展开截图底部"画布显示 0 / 4 条关联（完整列表见右侧「关联」页）"条）+ smoke 渲染 | 虚拟根无边渲染；关系上限 + 当前显示 M/N 指向「关联」页 | M/N 数字未 e2e 断言（截图目检）；补验：一条对底部条文本的断言用例 |
| B04 移动/历史（组织与移动） | 已实现未验证 | `SidePanel.tsx`（上移/移动归属/归档仅叶子）+ 后端历史分页 | api_smoke 88/88（后端语义：非法移动拒绝、归档、历史顺序/分页） | **后端全部通过**；前端操作路径无 e2e | 浏览器侧 上移/同级排序/环防护/归档恢复/历史 20+ 条 未 e2e；补验：5 个浏览器用例（对环移动被拒、归档→移动居首被拒、归档后恢复原位、历史翻第 2 页） |
| B05 AI 使用契约（单一真值） | 已修复且验证 | `docs/AI_USAGE.zh-CN.md`（主）、`AI_USAGE.md`（en 对照）、`DECISIONS.md`、`ai-session-example.md`、`examples/*`；批次 `docs(ai): …(B05/B06)` | CLI 实测 10/10 即为契约演练 + 两份文档互查 | 单一真值契约（commit 协议/预算/409/重试/身份）；中文为主、英文对照齐 | en 对照长期一致性靠 CONTRIBUTING 纪律，无自动 diff 检查 |
| B06 Web 内 AI 接入入口 | 已修复且验证 | `Workspace.tsx`（AiAccessModal） | 代码审阅 + ⋯ 菜单 e2e 回归 | "复制接入信息"为 `<你的令牌>` / `<服务器地址>` 占位，**无编造地址**；含 `RESEARCHMAP_BASE_URL`/`RESEARCHMAP_TOKEN` 两条接入命令 + context/commit/dry-run/409 命令行；"不需要模型 API Key"文案保留；数据声明行（合成演示数据） | 弹窗文案未在 e2e 中逐字断言（代码级审计通过）；补验：打开弹窗断言占位符 1 例 |
| B07 验收材料泄漏 | 已修复且验证 | 本文件 + 全仓敏感扫描 | `git status` + 绝对路径/凭证扫描 | `docs/acceptance-2026-09-13/`（用户原件，含本地路径与真实 ID）**未跟踪、未提交**；工作区新文件只含合成数据与令牌；计划文档行 3 绝对路径已改写 | 原件留在磁盘（untracked，安全）；Owner 自行决定公开发布前清理 |

### D 组 — 部署与数据

| 任务 ID | 状态 | 实现文件/提交 | 验证命令或场景 | 实际结果/证据 | 剩余限制 |
|---|---|---|---|---|---|
| D01 Compose 网络暴露 | 已实现未验证 | `compose.yaml`（`127.0.0.1:${RESEARCHMAP_PORT:-8000}:8000`）+ `Dockerfile`（容器内 `0.0.0.0:8000` 仅作文档说明）；批次 `build(deploy): …(D01/D02)` | 配置审阅 + YAML 合法性检查 | 端口绑定仅 loopback + 可配置，无 `0.0.0.0` 宿主绑定 | 真实容器绑定行为未跑（本地无 Docker）；补验：CI container job（boot + /healthz + 默认无令牌 401） |
| D02 构建可复现性 | 已实现未验证 | `backend/requirements.lock.txt`（Docker/CI 均用）+ 两段式 `Dockerfile`（npm ci / lock 安装）+ `.dockerignore`（10+ 项） | 本地文件/引用链审 + .dockerignore 覆盖核对 | 锁文件与使用链完整；镜像上下文排除 .git/env/node_modules/本地库 | "干净 Linux 环境从零安装"未本地复现；补验：CI container job 一次 build 即覆盖 |
| D03 容器与备份/恢复演练 | 未完成 | （无实现；依赖 D01/D02） | — | 本机无 Docker CLI 且无 docker.sock，无法执行任何容器步骤 | 补验：① CI container job 全绿；② 备份演练 `sqlite3 data.db ".backup backup/data-<ts>.db"` → 停用服务 → 恢复至目标 → 校验 revision/节点计数/深链可开；③ 备份仅含数据文件、不含令牌（令牌只在运行时 env） |

### G 组 — 交付门禁

| 任务 ID | 状态 | 实现文件/提交 | 验证命令或场景 | 实际结果/证据 | 剩余限制 |
|---|---|---|---|---|---|
| G01 README 标题 | 已修复且验证 | `README.md`（英文为主）、`README.zh-CN.md`（完整对照） | 两文件审阅 + 交叉引用检查 | 标题 `# Ideamify` + 应用名 ResearchMap 说明；不再宣称"中文为主"字样；`English 与简体中文` 交叉引用；无假冒 badge（LICENSE 前故意省略） | LICENSE 落定后再补 badge（G10） |
| G02 协同规范 | 已修复且验证 | `CONTRIBUTING.md` + `AGENTS.md` | `git log` 标题审阅 | 本交付 14 个英文 Conventional-Commit 标题 + 逐条 Co-Authored-By 尾注；提交前验证清单本地执行过 | PR 场景未跑（依赖 push 后分支保护，G10） |
| G03 Issue/PR 模板 | 已修复且验证 | `.github/ISSUE_TEMPLATE/{bug-report,large-graph-report,feature-request}.yaml` + `pull_request_template.md` | 文件存在 + frontmatter 审 | 三模板齐（large-graph-report 含视口/浏览器/总节点数/可见节点数/首帧耗时字段）；PR 模板带任务 ID 与证据列 | 模板未被真实使用过（Owner 首例使用即反馈入口） |
| G04 安全/CoC 文档 | 已修复且验证 | `SECURITY.md`、`CODE_OF_CONDUCT.md` | 文件审 | 信任模型（Bearer token = 信任边界、actor=token 名、令牌仅运行时 env）、409/422/404 契约、API 面；漏洞通报渠道**留白不编造**（指向 G10） | 安全联系人待 Owner 确定（G10） |
| G05 CI 管线 | 已实现未验证 | `.github/workflows/ci.yml` + `backend/tests/test_api.py`（去沙箱硬编码：解析 smoke 输出计数断言） | 五 job 的本地等价全部绿：`npm run build`（tsc 0 错）、`npm run test`（37/37）、pytest 1 passed（包裹 88/88）、e2e 12/12（全新 scratch）、仓库检查扫描（绝对路径/凭证/MD 链接/JSON 合法性） | CI：PR/push/main + dispatch；concurrency 取消旧跑；Node 22 / Python 3.13 基线；actions 引用 tag + `# TODO(pin)`；e2e chromium；container job；扫描 job | **已配置、尚未在远端运行**——需 push 后 CI 全绿一次方可改判 `已修复且验证`；actions 未钉 SHA（网络受限，TODO(pin)）；本地 Node 24 与 CI 基线 22 待消差 |
| G06 依赖与工具链 | 已修复且验证 | `.github/dependabot.yml`（npm/pip/github-actions/docker，weekly）+ `.editorconfig` + `Canvas.tsx`（历史 blob 2 个 NUL 字节 → 空格，工作树为合法 UTF-8）+ `.gitignore`（`*.db`/`.env*`/`backup` 等） | 覆盖核对 + 全仓扫描（绝对路径/类令牌串；e2e 与验证令牌均为合成值守） | 扫描干净；Canvas 旧 blob 的"二进制"标记源于旧版本含 NUL，本批提交后即转纯文本 | actions 精确 SHA 钉死待网络环境（TODO(pin) 注记）；§10 延后项（自动发版/CLA/机器人/i18n/D05 等）均未实现，符合边界 |
| G07 CHANGELOG/版本标签 | 已修复且验证 | `CHANGELOG.md` | 文件审 | Unreleased 段齐（Added/Changed/Fixed/Security，英文）；声明"No tags have been published"；semver 与协议 `schema_version` 分离 | 具体 tag 与发布文案属 Owner 决定（G10） |
| G08 证据与截图 | 已修复且验证 | `docs/images/{workspace-1440x900,detail-panel-1280x800}.png` + `docs/evidence/{a03-firstopen-1440x900,a03-firstopen-1280x800,a03-branch-expanded-1440x900}.png` | 全新 scratch 库整跑（e2e 12/12）后由 screenshots 用例再生，与代码同批提交 | README 两截图为修复后真实浏览器截图（合成数据，已标注）；A03 大图读数三张证据入库 | 卡宽 280px 的精确像素断言未做（截图已盖可读性）；补验：screenshots 用例加一条 `clientWidth===280` 断言 |
| G09 文件职责分离 | 已修复且验证 | `WORKSPACE.md`（交互/布局）、`PROTOCOL.md`（提交契约/预算/类型）、`docs/AI_USAGE.zh-CN.md`（AI 使用纪律） | 三文档共享事实扫描（协议版本/预算/类型枚举均回指单一真值） | 互相同名事实均已统一，无相互矛盾措辞 | 无 |

---

## 3. G10 — 待所有者决定（本地无法代办）

| # | 事项 | 当前事实 | 建议 | 具体操作 | 需 Owner 处理？ |
|---|---|---|---|---|---|
| 1 | LICENSE 与版权 | **无 LICENSE 文件**；README/CHANGELOG 均声明"license pending"；badge 因此省略 | 若对外开放：MIT 或同级的宽松许可；若内部工具：私有声明文件 | 选定后放 `LICENSE` 文件 + README/badge 同步；已写文档措辞可一键补全 | **是**（法律决定，不可代办） |
| 2 | 安全漏洞通报渠道 | `SECURITY.md` 已给出信任模型与诚实说明，但通报渠道**留白**（未编造邮箱/SLA） | 用 GitHub Private Vulnerability Reporting（需仓库开启）或加密邮箱 | Owner 选定渠道后在 `SECURITY.md` 补 2 行（渠道 + 期望响应时限） | **是** |
| 3 | 仓库名称/描述/topics | 仓库名 `Ideamify`（沿用），应用名 ResearchMap（README 已注明两者关系）；`description`、`topics` 未设 | description：`ResearchMap — 科研演化地图：研究者与多个 AI 协同的研究与证据演化树`（或纯英）；topics：`research-map` `ai-collaboration` `fastapi` `react` `sqlite` | GitHub 仓库 Settings → General 三字段；PR 可直接提 | **是**（品牌措辞） |
| 4 | 可见性与真实数据迁移 | 本地工作区无真实研究数据库入库；compose 已强制 loopback | 在真实数据完成凭证迁移与内容敏感审查前保持 private；迁移后据内容再评 | Owner 决定时点；届时可要求一次提交级敏感扫描（本交付的扫描方法已在 CI 的 repository checks 可复用） | **是** |
| 5 | 分支保护 / ruleset | 本地代理仓库，未配任何保护 | main：PR 合并（禁直推）、强制 CI 绿、禁 force push | GitHub Settings → Branches 或 Rulesets；前置：试 push 一个保护规则草案（本交付未代办） | **是**（仓库侧配置） |
| 6 | 合并方式 | 本交付提交均为英文 conventional 单行摘要 + 尾注，与 squash 习惯相容 | squash + 英文摘要 | 分支保护中设 Squash & merge；与 #5 一次配置 | **是**（低风险，可一次带过） |
| 7 | 仓库安全特性 | `dependabot.yml` 入库（4 生态，weekly，limit 5）；repo 绑定即启 | 推送后开启：Dependabot alerts、secret scanning、Private Vulnerability Reporting（接 #2）；CodeQL 可后 | 推送后逐项开启 | **是** |
| 8 | Push 与首次发布 | 本地 14 批提交就绪，**未 push、无 tag、无发布** | Owner 授权 push → 分支 CI 全绿 → 按 #6 合并 → 再行首次 tag/发布（CHANGELOG Unreleased 已备好文案） | ① Owner 给 push 授权 ② `git push` 后回看 CI 5 job ③ 合并 ④ 决定 v0.2.0 与否 | **是**（发布权限） |

---

## 4. 执行中发现的附带问题（计划外，已修复/已记录）

1. **⋯ 菜单首点失效**（A09 邻接交互缺陷）：顶栏 `⋯` 菜单首次点击只能弹开、第二点才动作。已修复（`menuRef.contains` 自关闭判定）并加 e2e 回归断言。
2. **MiniMap 角块在大图下渲染空白**：1104 节点项目两次截图一致（右下角纯白角块，仅 "React Flow" 归因）。不阻塞任何验收项；建议：节点数超阈值（如 >300）时改为按钮呼出的浮层大图，或增大角块并加描边。
3. **1100+ 规模首开 zoom 0.4 的取舍**（见 A03）：结构可读、字符需缩放/搜索/分支视图导航。记录为设计行为，不作为缺陷。
4. **分支视图单卡 fit 偏左**：见 `docs/evidence/a03-branch-expanded-1440x900.png`（根卡贴左）。建议 fitBounds padding 增大 40–80px；不阻塞。
5. **e2e 默认库不自动清空**（`/tmp/rm-e2e` 跨运行累积）：A01 空库用例已加保护（库非空则 skip 并提示 `E2E_DB_DIR=$(mktemp -d)` 单跑）；CI 每次全新 /tmp，字母序最先执行的 acceptance 用例天然拿到空库。

---

## 5. 交付检查清单（对齐计划 §9）

- **未 push**：`git log` 仅本地提交；远端 origin 存在但零写入。
- **无 tag / 无发布 / 无 npm publish / 无可见性变更**。
- **§10 延后项未实现**（自动发版、CLA、机器人、i18n、demo、CITATION/DOI、多平台镜像）。
- **真实数据库未触碰**：全部验证走临时库与临时端口（§1 列表）；仓库内无 `*.db` 被跟踪。
- **临时资源已清理**：scratch 服务器全部终止；`/tmp/rm-e2e`、`/tmp/rm-acc*`、`/tmp/rm-cli-verify`、`/tmp/rm-stress` 交付前删除。
- **用户原件未入库**：`docs/acceptance-2026-09-13/` 保持 untracked。
- **结论**：本地实施完成；**发布仍待 G10 八项 Owner 决定 + D03 容器演练 + G05 远端 CI 一次全绿**。

---

## 6. 证据文件与复现命令

### 证据文件

| 文件 | 说明 |
|---|---|
| `docs/images/workspace-1440x900.png` | README 用：工作区（合成数据标注） |
| `docs/images/detail-panel-1280x800.png` | README 用：节点详情面板（合成数据标注） |
| `docs/evidence/a03-firstopen-1440x900.png` | A03：1104 节点项目浏览器首开（zoom 0.4，104 卡、100 个 +10 徽标） |
| `docs/evidence/a03-firstopen-1280x800.png` | A03：同上 1280×800 |
| `docs/evidence/a03-branch-expanded-1440x900.png` | A03：右键"只看这一分支"→"展开此分支"（11 卡 = 1+10，红态节点高亮） |

### 复现命令（本地）

```bash
# 前端：类型检查 + 构建 + 单测（37 用例）
cd frontend && npm ci && npm run build && npm run test

# 后端：pytest 包裹 api_smoke（88/88，含 A04 预算/截断/422、并发 200/409）
backend/.venv/bin/python -m pytest tests/ -q

# E2E 全量（12 用例；默认库 /tmp/rm-e2e，建议全新）
cd frontend && rm -rf /tmp/rm-e2e && npx playwright test

# A01/A08 空库单跑（acceptance 需全新数据库，否则自动 skip 并提示该命令）
cd frontend && E2E_DB_DIR=$(mktemp -d) npx playwright test e2e/acceptance.spec.ts

# 压测（1104 节点 / 3000 关系；输出延迟汇总并再生 layout fixture）
python3 scripts/stress_test.py
```

### 附录 A：A05 CLI 十项实测序列（临时脚本已清理，等价手工照跑即可）

服务器：`RESEARCHMAP_DB=$(mktemp -d)/data.db RESEARCHMAP_TOKENS='{"researcher":"researcher-token-0001"}' uvicorn …` :8031

1. `session` → actor=researcher
2. `create-project --file create1.json`（含 request_id）→ 2xx + id
3. 同文件重放 → 同一 id（幂等）
4. `projects` → 恰好 1 个项目
5. `commit <pid> ops.json`（文件无身份）→ 成功 + 文件被回写 request_id/expected_revision
6. 同文件再跑 → 不产生第二个 commit（revision 不变）
7. `commit --dry-run` → 2xx 且 revision 不变
8. stale `expected_revision` → exit code **2**
9. 该 409 的 stderr 可被 `json.loads` 解析，`error.code == REVISION_CONFLICT`
10. （环境）全程仅 `RESEARCHMAP_TOKEN` 环境变量取令牌，无 CLI 令牌参数

### 附录 B：A03 大图浏览器读数摘要（脚本已清理，方法可复现）

压测项目跑 `scripts/stress_test.py` 后，用 `RESEARCHMAP_DB=/tmp/rm-stress/data.db` 起全形 uvicorn；headless Chromium（Chromium headless，Playwright）按 1440×900 / 1280×800 打开项目：

- 首开：令牌→首卡 244/245ms；`graph` API 50/44ms（444 KiB 传输）
- 可见卡 104（4 一级 + 100 二级）；折叠徽标 100×"+10"；展开钮 4；相机 zoom 0.4（卡屏宽 112px 实测）
- 纯 computeLayout（Node 原生 TS 直跑 layout.ts，1104 fixture）：全树 0.81ms / 默认两级 0.43ms（各 7 次取中位）
- 搜索"压力节点 0550"：2896ms 到选中，详情正确
- 右键（菜单 5 项：打开详情/新增子节点/展开此分支/只看这一分支/复制节点深链接）→"只看这一分支"（保留折叠态 → 1 卡）→"展开此分支"→ **11 卡**，相机 zoom 0.4
- 1280×800 视口读数同构（9 张卡完整入屏 + 2 张半入屏）