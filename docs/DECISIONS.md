# DECISIONS.md — 实现期小决策记录

SPEC 未规定、实现中被迫选定的事，逐条记在这里（含理由与落点）。
大决策（布局只用 parent_id、红状态证据门槛、无自由拖拽……）以
`docs/SPEC.md` 为准，不在此重复。

## 1. 分支聚焦时，分支根成为可见树的顶级节点
- SPEC 4.1 要求聚焦一条分支后“只看该分支子树”。d3-hierarchy 只能从
  **顶级节点**（`parent_id === null`）向下展开；若只过滤而仍以一级节点
  为根，分支根的内部结构会丢失。
- 决定：可见树根 = （聚焦分支时）分支根本身，否则一级节点。祖先链由
  面包屑 + 服务端 `ancestor_path` 表达，不再占用画布。
- 落点：`frontend/src/lib/layout.ts`（`isTopOfVisibleTree`）、
  `backend/app/context.py`（`ancestor_path`）。

## 2. `GET /projects/{pid}/nodes/{id}` 增加 `child_count`
- 前端“仅叶子归档”判断单节点详情时需要知道有无子节点；不加字段就要
  多发一次 graph 请求。
- 决定：未归档直接子类计数的整型字段 `child_count: number`
  （0 ⇒ 叶节点，可归档）加入节点完整响应。
- 落点：`backend/app/views.py:get_node`、`frontend/src/lib/types.ts`
  （`NodeFull.child_count`）、`SidePanel` 归档资格逻辑。

## 3. `api.ts` 合并为单一 default 导出
- 原文件里 namespace 对象 `H` 与同名 default 导出并存，调用方
  `import * as api` / `import api` 混用，编译期暴露了类型不匹配。
- 决定：只保留 `default export api`（方法集）与 `setToken`。
- 落点：`frontend/src/lib/api.ts` 及其全部调用方。

## 4. `Node.tags` / `evidence` 是 JSON 字符串列 → 统一经 `_lj()` 解析
- 这些列以 JSON 文本存储；早期 `context.py` 把 JSON 字符串按**字符**
  拼接成 “tags” 列表，输出如 `"["","\"","成","核","\"","…`。
- 决定：`_lj(s)` 负责解析（list/tuple 直透，空返 None，坏 JSON 返
  None 由调用方 `or []` 兜底）；所有 tags/evidence join、计数处都走它。
- 落点：`backend/app/context.py`（`brief().tags` 与 focus 短标签两处
  join）。

## 5. `@xyflow/react` 12.11.6 API 对源码的适配
- **`onReady`→`onInit`**：v12 中 `useReactFlow` 不再暴露 `onReady`；
  自定义 `onInit` 注册到 `ReactFlow` 后由 `fitView` 触发初始适应。
- **自定义边 marker 不自己挂 `<marker>`**：Element 是框架渲染的对象。
  给 `Edge.markerEnd` 传 `{type,width,height,color}`，框架在独立
  `<defs>` 中注册 marker 并把解析后的 `url(#…)` 透传给 `EdgeProps`。
  `related`（无向）不传 markerEnd。
- 选边状态存于 `Edge.data`（`{item,selfId,hovered,selected,onHover,
  onClick}`），配合 hover 透明加宽路径。
- 落点：`frontend/src/workspace/RelationEdge.tsx`、`Canvas.tsx`。

## 6. 视图稳定性：结构变更平移 viewport 而非重置
- SPEC 2.5：换子树/折叠后，**选中节点**（无选中时用虚拟根锚点）的
  屏幕位置与 zoom 保持不变。
- 实现：新布局对旧布局取 delta，`panBy(delta)`；仅首次进入、
  “适应当前图”、显式导航/定位（locate）三类事件重置视图。
- 落点：`Canvas.tsx`（`structKey` effect）、`Workspace.tsx` 的
  `structKey` 组合。

## 7. CLI 的身份字段是**持久化**的（A05 修订）
- `tools/researchmap.py` 的 `--base` 是**子命令级**参数（各子 parser 经
  `common_args()` 携带）；**必须写在子命令后面**
  （`researchmap commit <pid> f.json --base …`，写在子命令名前报
  `unrecognized arguments`）。凭证只走环境变量：`RESEARCHMAP_BASE_URL`
  （规格别名 `RESEARCHMAP_URL` 仅作回退）、`RESEARCHMAP_TOKEN`；
  按合同（SPEC 7.3 / A05.6）令牌不出现在 argv，`--token` 已移除。
- **commit 身份准备**：文件缺 `request_id` 或 `expected_revision` 时，
  CLI 生成取值（revision 读自当前项目）并**原子回写进文件**（stderr 有人读
  提示）。文件即"可重放工件"：重复同一条命令 = 逐字节相同请求 = 幂等
  重放（`already_committed: true`）。
- **字段一经存在绝不改动**，`--auto-rev` 也不例外（其旧语义"总是刷新
  revision"已废弃；现在只表示"缺失才准备"）。过期的 `expected_revision`
  会 409，由调用方重读地图后**显式重写文件**——CLI 不静默刷新，防止
  "刷新版本绕过冲突"变成默认补救。
- `--auto-rev` 与 `--dry-run` 均不落库；`dry_run=true` 只走查询参数，
  从不写入文件。
- 落点：`tools/researchmap.py`（`_prepare_identity`、`cmd_commit`、
  `cmd_create_project` 的 `--file` 路径同样回写 `request_id`）。

## 8. 409 不落 row ⇒ 复用同一 request_id 合法
- 版本冲突的提交**没有** Commit 记录；把同一 payload 以最新
  `expected_revision` 重发（可同 request_id）属于重试，不是复用。
- 只有”同一 request_id **既已 commit** 又换了内容”才
  `IDEMPOTENCY_KEY_REUSED`。canonical hash 覆盖
  `expected_revision/summary/client_label/operations`（`request_id` 与
  `dry_run` 不在其中）。
- 因此：服务器 409 文案”保持相同 request_id”是对的；CLI 的
  `REVISION_CONFLICT` 提示此前误写”用新的 request_id”，已统一。
- A05 修订后的措辞落点：409 指引不再作为散文追加在 JSON 之后，而是错误
  JSON 对象里的 `hint` 字段；且 CLI 不会代刷文件里已持久化的
  `expected_revision`（见 §7、§12）。
- 落点：`backend/app/service.py`（submit 顺序：幂等→版本→操作→落
  行）、`tools/researchmap.py`、`docs/ai-session-example.md` §4、
  `docs/AI_USAGE.md` §3.2–3.3。

## 9. `details_md` → 受控 Markdown
- `marked`（gfm:false, breaks:true）→ DOMPurify：
  `FORBID_TAGS = [script,style,iframe,object,embed,form,input,button,
  select,textarea,img,picture,video,audio,source,base,link,meta]`
  + `ALLOWED_URI_REGEXP = /^(https?:\/\/|mailto:)/i`；`<a>` 自动加
  `rel="noopener noreferrer" target="_blank"`。
- `markdownToPlainText`（DOI/链接复制用）保留 code-fence **内容**，
  只剥 ``` 行头（旧实现误删整段代码块）。
- 落点：`frontend/src/lib/markdown.ts`。

## 10. 例示 AI 端会话用**独立 terminal** 完成
- 不通过 browser 脚本模拟“AI”——直接用 `tools/researchmap.py` +
  curl/Python，另开 shell。会话完整实录（真实命令 + 真实输出节选）：
  `docs/ai-session-example.md`。
- 该实录同时验证了：context 全文、搜索、422 证据门、幂等重放、
  IDEMPOTENCY_KEY_REUSED、409 并发冲突与同一 request_id 重试。

## 11. 备份走 SQLite **Online Backup API**，不裸拷文件
- 对 WAL 模式的活库 `cp`/`shutil.copy2` 会丢掉只落在 -wal 里的页
  （实测：手工拷贝的副本缺表；在线备份副本数据完整，
  项目/节点/关联/提交计数一致）。
- 因此 `tools/backup.py backup` 用 `src_con.backup(dst_con)`，随后把
  副本 `PRAGMA journal_mode=DELETE` 转成单文件工件（可整体搬走），
  并跑 `integrity_check` + 计数核对；`restore` 要求 `--server-stopped
  --yes`，先验证源、再留下 `.pre-restore-<ts>` 现场、最后再验证。
- 落点：`tools/backup.py`（`backup/verify/show/restore`）。

## 12. CLI 与 AI 文档合同（A05/B05）
- **为什么请求身份要持久化到文件**：dry-run、正式提交与网络重试必须共用
  同一份完整请求体，否则"同一个命令跑两遍"会变成两个不同请求（验收
  A05 复现的两个提交）。文件是最简单的可重放工件：生成一次、落盘一次、
  之后逐字节重放即幂等。网络回执丢失时重发同一文件也是安全的。
- **退出码表（稳定，`--help` 与 AI_USAGE 同文）**：0 成功；1 本地/用法
  （坏文件、缺 `RESEARCHMAP_TOKEN`、argparse）；2 HTTP 409；3 HTTP 422；
  4 网络失败或 5xx/503；5 其余非 2xx。
- **机器可读输出合同**：stdout 成功时恰好一个 JSON 对象（服务器响应原样；
  例外仅 `context --format markdown` 与 `graph --text`）；stderr 失败时
  恰好一个 JSON 对象 `{"ok": false, "error": {status, code, message,
  response}, "hint"?}`，其后不追加散文；人读提示（身份回写等）只走
  stderr。
- **凭证只走环境变量**（`RESEARCHMAP_BASE_URL` > `RESEARCHMAP_URL` 回退；
  `RESEARCHMAP_TOKEN`）；`--token` 移除（令牌不得出现在 argv/文件/URL/
  日志）。`--base` 保留为子命令级便捷覆盖。
- **规格别名**：`--node`≡`--focus`、`--query`≡`--q`、`--output`≡`--out`、
  `create-project --file` / `commit --file` 与位置参数并存、
  `context --format json|markdown`（默认 json）。位置参数与 `--file` 严格
  **二选一**：两种都给出（无论路径是否相同）→ `USAGE` 退出码 1。复核实测
  发现旧实现会在双规格同值时静默接受并**真实落库**，已收紧。
- **文档语言**：`docs/AI_USAGE.md` 为英文主入口，`docs/AI_USAGE.zh-CN.md`
  为事实一致的中文对应版；examples 的方向/ID 准备说明以 AI_USAGE §7 为准
  （提交文件本身是严格 JSON，不能携带备注字段）。
- 落点：`tools/researchmap.py`、`docs/AI_USAGE.md`、
  `docs/AI_USAGE.zh-CN.md`、`docs/ai-session-example.md`、`examples/*`。

## 13. 视图偏好存储：三键分工 + SavedView v2（A1/A6/B2）
- **一个关注点一个键**，让高频写者永不共享状态：
  - `rm.lang` 全局语言（`lib/i18n.ts` 独占）；
  - `rm.prefs.app` 全局 chrome 侧栏偏好 `{width, collapsed}`；
  - `rm.prefs.<pid>` 每项目视图选择 `{layout, density, lowInterference}`；
  - `rm.view.<pid>` SavedView——按布局分槽的折叠/分支/视口。
- `rm.view.<pid>` v1 是无版本 `{folds, branchRoot, viewport}`；v2 包成
  `{version:2, layouts:{h|v|outline}}`，旧 blob 读回即 `layouts.h`。全部
  `lib/viewPrefs.ts` 收口（2026-09 起 Canvas 的旧 `loadSavedView/saveView`
  是其 h 槽兼容别名）。
- **两个既有承重 read-modify-write 写者**（Canvas onMoveEnd 的视口、
  Workspace folds effect 的折叠）行为不变，只是按当前布局选槽；
  侧栏宽度一类高频写入不并入该键。
- **首开默认（A03 virgin）**：`h` 树沿用视口启发（折叠空 + 视口空 ⇒
  initialFolds）；布局切换处 v2 能区分「槽不存在」与「显式全展开」
  （`hasLayoutView`），切换时槽不存在 ⇒ initialFolds，显式条目逐字恢复。
- **A6 注记**：批量工具的「恢复上次」快照只覆盖批量工具换掉的那一批
  折叠；卡片上的手动折叠不参与快照（单步语义保持可预期）。

## 14. 信息密度三档：阈值/回差/档位不动坐标（B1/B4）
- 三档「阅读 / 精简 / 概览」由 zoom 驱动（自动档）或锁定（阅读/精简/
  概览/自动 分段控，写 `rm.prefs.<pid>.density`）。纯函数
  `resolveTier(prev, mode, zoom)`（`lib/detailLevel.ts`），单测覆盖。
- **阈值是初始设计参数，待视觉验证**：阅读下界 0.70、概览上界 0.35
  （常量 `TIER_ZOOM`）；进入/离开各 ±0.02 死区，回差 `TIER_HYST=0.04`，
  边界来回不抖（E2E 快速往返断言）。
- **档位绝不改坐标**：卡片盒常为 280×144，档位只改画什么（CSS 类
  `.rm-card.tier-*`）；布局与选中定位对档位无感（E2E 断言）。
- 图形辅助编码：状态色不变，字形 `STATUS_GLYPH` 为语言无关符号
  （○◐◇✓✕≈），概览档以「色块+字形」辨认卡片；状态图例 chip 常驻
  非阅读档。
- 概览层的路线名/选中浮层（`OverviewLabels`）为屏幕空间元素，尺寸
  不随 zoom 缩放；去重叠按 (depth, order, id) 确定性推挤，同输入必出
  同布局。
- **枚举仍英文**：API 的 status/kind 等永远不改值；界面文案经
  `statusLabel` 等映射（§16）。
- 低干扰模式 = 视图选择（`rm.prefs.<pid>.lowInterference`）：隐藏卡片
  标签/计数与关系线悬停标签，图例可展开对照。

## 15. 布局策略：h/v 共用 d3 几何，大纲不走 layout（B2/B3）
- `lib/layout.ts` 策略化，**保所有旧导出签名**；
  `computeLayout(..., mode="h")` 使横树坐标逐字节不变。每模式常量：
  - `h`（SPEC 2.4 原样）：`nodeSize [176, 380]`，d3 轴互换
    （canvasX=d3.y−W/2，canvasY=d3.x−H/2）；
  - `v`（纵树）：`NODE_SIZE_V=[344, 208]`——sibling 轴 344=卡 280+64
    沟槽（对卡宽比即横树 176:280 的空气比），depth 轴 208=卡高
    144+64 连线带；d3 轴直出；卡仍 280×144。
- 确定性与不重叠**按模式成立**：同 (树, order, folds, mode) 出同坐标；
  `layout.test`/`layout.stress` 以 `describe.each` 双模式回归，h 的旧
  坐标断言原样保留、v 是新增期望。
- **性能实测（B5 决定不落 perf 提交）**：1104 节点 fixture 上
  `computeLayout` 均值 h 0.8 ms / v 0.7 ms（2026-09-14，各 10 次取均），
  远低于既定的 ~250 ms 单趟重写阈值，现状分支 BFS 不需替换；如未来
  超阈值再按既定方案落单趟可见性。
- **大纲不走 layout.ts**：`OutlineView` 直接复用
  `buildTreeData`（折叠/分支语义与画布字面共享），文字行没有坐标；
  选中态跨模式天然保持（同一 selectNode）。
- 边锚点随模式翻转（h left/right，v top/bottom），大纲无关。
- **关系仍不进布局**：只有主树决定坐标（SPEC 2.4 不变）；关系线是
  选中节点的叠层。

## 16. i18n 政策（A2–A4）
- **zh 源字典**：`dict.zh.ts` 是唯一真相（`as const`），值 = 现硬编码
  中文串逐字节；`dict.en.ts` 类型 `Record<keyof typeof zh, string>`，
  缺英文键 = tsc 编译错。
- 无 context、无 react-i18next：普通 `t(key, params)` + 模块态 +
  `useSyncExternalStore`（`useT()`），语言切换即时重渲染、不刷新页面；
  选择持久化在 `rm.lang`，首启同步探测（避免闪屏）。
- **只翻界面 chrome**：标题/正文/标签/证据等用户内容永不翻译；
  API 枚举与错误码原样透传（错误正文带服务端数据时改用带参模板，
  未知错误原文透传）。
- **E2E 钉 zh-CN**（`playwright.config.ts use.locale`）：旧 spec 的
  中文可访问名选择器不受语言切换影响；新控件同时带 `data-testid`。

## 17. 画布草稿会话：创建态统一、卡片覆盖、请求身份（C 批 §10）
- **创建走「草稿会话」，训练同一套编辑心智**：旧实现里新建走 CreateNodeModal
  （提交前画布不可见）、编辑走 draft/draftBase，两条路径体验割裂。C 批把
  「+ 一级路线」/「+ 子节点」/右键新增全部改为打开 Workspace 级
  `nodeDraft` 会话（id/requestId 在会话开启时定死），画布虚线 DraftCard
  与侧栏表单编辑同一份状态；CreateNodeModal 退役。
- **画布定位是纯函数**（`lib/layout.ts:draftPlacement`）：草稿不是树节点，
  绝不进 `computeLayout`（不扰动既有坐标）；子草稿停靠锚点右侧/下方
  96px 沟槽，顶层草稿排在最后一条可见一级路线之后，12px×240 步避让，
  折叠父级回退最近可见祖先。同输入必同坐标（单测覆盖 h/v 两模式）。
- **空图例外**：0 节点时 `computeLayout` 为空、无处停靠 → 画布不渲染草稿
  卡（编辑走侧栏）；播种首个节点后恢复。E2E 已写明该前提。
- **请求身份 = 幂等闸口**：request_id 固定在草稿状态内，保存失败/断网/
  409 后草稿保留、原样重试，服务端幂等保证至多一条提交、一个新节点。
  每次输入都不写库（§3.3 语义不变），「确认输入」与「保存」分离：
  卡片标题 Enter 只 blur 短编辑（IME 组合中绝不触发，keyCode 229/
  composition 守卫），⌘/Ctrl+Enter 或按钮才提交。
- **诚实降档**：大纲模式草稿渲染为只读虚线行（大纲本身不承载编辑），
  会话跨布局存活；正在编辑草稿的既有节点卡片显示「未保存」徽标，让
  编辑态在图上可见而不只在面板里。
- **风险落点**：侧栏草稿表单复用旧弹窗的中文可访问名（新增节点/创建），
  旧 E2E 选择器无需改名即通过；`forceOpen` 拉起已收起的详情面板承载
  草稿表单（收起面板的 overflow 裁剪会让 Playwright 误判可点击）。

## 18. 受管图片附件：引用语法、认证字节流、staged/attached 生命周期（D 批 §9）
- **引用语法 = 纯 Markdown 源**：正文里附件写作 `![alt](attachment:<uuid>)`，
  剪贴板复制、导出、全文搜索全部可用；`attachment:` scheme 语法上不与
  真实 URL 冲突。渲染走分段（`lib/attachments.ts`）：正文段照常过净化器
  （`<img>` 仍在 FORBID_TAGS），附件段由 `AttachmentImage` 组件经
  **Authorization 头**取 `GET /attachments/{id}` 字节 → `objectURL` 渲染。
  **Bearer 令牌永不出现在 `<img>` URL**（页面内存令牌语义 §9 不破）。
- **外链图片一律不加载**：`![x](https://…)` 降为占位条、只显示 URL 文本
  （承接「不提供任何外链预览/探测面」边界）；`data:` 等其他 scheme 同样
  不进渲染。外链「点击加载」显式不做。
- **两态生命周期**：上传即 `staged`（同项目同 sha256 幂等去重），提交事务
  内扫描 node.create/node.update 的 details_md + evidence 引用 →
  同事务翻转 `attached`（**node.update 的字段在 `.fields` 里——首轮实现
  漏扫，e2e 抓出后已修**）；attached 永不删（不可变内容，替换=新 id），
  staged 且无节点引用超 30 天在上传事务顺带 GC（无后台线程）。
- **限宽闸口**：2MiB 全局 body 闸仅对上传路径正则豁免；单文件 ≤10MB、
  Pillow 探尺寸 ≤8000px、类型必须 image/* 全部在**路由内显式校验**，
  不放宽其他端点。
- **出口三件套**：export 升 `schema_version: 2` 带附件元数据（字节不入
  JSON——随备份包走）；backup 把字节按 manifest（逐文件 sha256 记账，
  缺失/损坏只记不中断）拷入 `<out>/attachments/`；CLI 只提供只读列表
  子命令——**写入通道只有 UI/API**（stdlib 手写 multipart 收益低）。
- **部署面**：字节目录 `RESEARCHMAP_STORAGE`（默认 `<db dir>/attachments`，
  与库同卷；Docker 指到同一 /data 卷即随备份带走）。测试用 multipart
  边界不带前导连字符（python-multipart 对 `--xxx` 形状的头值偶发解析偏移）。

## 19. 科研版本与泳道：版本≠记录号、筛选=上下文闭包、全量网格（E 批 §7）
- **科研版本与保存记录号完全无关**：`research_versions`（迁移 0003）是
  v1/v2/v3 阶段标签（显示序号 = `order_index + 1`），随方案推进增减；
  revision 每次保存都 +1，界面统一显示「记录 #N」（含详情冲突条与 toast），
  从措辞上杜绝「给节点打 v1 标签」被理解成「回滚到某次保存」。
  **版本历史时间旅行显式不做**——标签只对当前内容生效。
- **归属走 commit 机制**：`version.create/update/archive` 与
  `node.create` 的可选 `version_ids`、`node.update` 的
  `fields.version_ids`（**显式数组=整组替换，省略=不动**，与 partial
  fields 语义一致）全部走统一提交协议，幂等/409/回滚/changes 历史免费
  获得；服务端校验引用的版本存在且未归档（422），归档不级联清空已有
  归属（历史呈现保留，仅停止新分配，提交带 warning）。多对多存
  `node_version_assignments`，节点上的 `version_ids` 是只读派生视图，
  API/导出都从它出。
- **筛选 = 匹配 ∪ 祖先上下文闭包**（`lib/versionFilter.ts`）：严格按
  归属过滤会让绝大多数命中节点变成孤儿（主树布局跳过孤儿，§SPEC 2.4），
  画布几乎空掉；方案 §7.3 明确「为缺失的祖先显示上下文路径」，故可见集
  是命中节点加其祖先链。选中的节点被筛掉时详情面板给「当前视图外」+
  「清除筛选并显示」。筛选态存 `rm.prefs.<pid>.versionId`（项目级共享，
  不进 per-layout 保存视图），跨布局、跨刷新存活；「未分配」视图用
  `__unassigned__` 哨兵。展开工具按筛后集合计数——「展开全部」的语义
  就在当前筛选范围内，不清筛选。
- **泳道是全量在筛人口的网格**（`lib/layout.ts:computeSwimlane`）：列 =
  版本（order_index 序）+「未分配」伪列置尾；行 = 一级线路（祖先链被
  筛断时最高存活节点自成一行）；cell 内按 (order_index, id) 全局序以
  160px 步进堆叠，两趟算法按行累计高度防高泳道压进下一行。**树边不画、
  折叠/聚焦分支有意忽略**——泳道不是树的另一种画法，而是按方案 §7 一张
  版本×线路的进度表（Excel 心智，表头走屏幕空间覆盖层不随缩放放大）；
  关系线照常作为选中覆盖层显示，不做跨列特殊化。同 (节点、版本、顺序)
  ⇒ 同坐标；1104 节点实测 ~1.2ms（250ms 闸门富余）。
- **多版本节点按命中泳道各出一个显示实例**：一个业务节点在泳道里按每条
  命中的版本各渲染一张卡，实例 id = `nodeId::版本键`（主实例保留业务 id，
  定位/草稿锚点/详情解析都落回业务 id）；全部版本视图下每条命中版本各占一列，共享徽标列出全部
  命中版本；单版本筛选落命中列，不回退首列。此前「只显示首个归属列」的
  降档在验收返工中收回（F04）。
- **版本管理走 UI 闭环**（38）：`version.update` 增补可选
  `fields.after_id` 顺位调整（语义与 `version.create` 一致：省略=不动、
  显式 null=置顶、UUID=移到其后；归档版本仍整体拒绝 update），上移/下移
  按邻居计算参照——无新增 op、无迁移。入口两处：⋯ 菜单「科研版本管理」
  （空项目也可达）与视图菜单版本筛选行内的常驻「管理」钮；创建/重命名/
  归档一律走 commit 通道进历史。归档不可逆（服务端无取消归档），弹窗
  明说；排序把归档版本保留在参照列表里（顺序不歧视历史标签）。
- **顺带收敛**：泳道加入后 LAYOUTS = h/v/outline/swimlane 四态，各保存
  视图槽随 LAYOUTS 常量扩；viewPrefs 的 junk 枚举测试原来拿流行的
  `"swimlane"` 当非法值，泳道转正后果断换成 `"diagonal"`。

## 20. 验收返工批（2026-09-15）：草稿可循、控件诚实、文案归位

按独立验收报告返工 F01–F08；设计取舍记录如下。

- **纯文本编辑不做重排**（F06）：已有节点的草稿以只读 `preview` 覆盖
  CardData 进卡片渲染（标题/摘要/状态），布局坐标从不读它——memo 依赖
  加了 preview 但位置输入不变，纯文本编辑永远不触发 re-layout；「未保存」
  徽标只认 dirty 标记（只打开编辑不算改）。
- **草稿不需要正式节点当锚**（F05）：`draftPlacement` 删除全部 null
  返回路径——空图/空筛选用画布原点（即首张根卡会落的位置），父级被筛掉
  时沿祖先链上溯；泳道走独立 `swimlaneDraftPlacement`（一级=未分配列
  网格下方，子级=父主实例下方一格），避让走有界 240 步 12px 下移，宁可
  重叠不可消失。锚不存在的泳道草稿不画临时边。
- **泳道收敛死控件**（F07）：泳道忽略折叠/分支，所以三层的折叠/分支
  控件一起消失（工具栏两钮与菜单项、卡片折叠钮、右键两项），密度/低干扰/
  布局/版本筛选保留——「隐藏」即答案，不做可点击的 no-op。顺带修掉
  E2E 用按钮序号定位 ⋯ 菜单的隐患（改 testid）。
- **大图概览入口**（F08）：1104 节点 Fit View 后投影标签全在屏外，加
  屏幕空间固定「路线导航」栏（可折叠，条目=全部可见一级路线），点击
  放大定位到该线路；比「换布局/降最小缩放」诚实——导航不改变地图语义。
- **文案归位**（38）：应用自身的版本一律「应用版本 vN」，项目保存编号
  一律「记录 #N」（顶栏 conn、根卡、近期变化、进入项目按钮四处收口）；
  科研版本标签继续是 v1/v2/v3 序号（§19），三者不再混写。

## 验收状态（2026-09-14，Docker 补验后无未验证项）

- **容器验证已补做（2026-09-14）**：开发环境已具备 Docker
  （29.4.0 / compose v5.1.2），以完全隔离的演练项目完成全流程：
  `docker compose -p <scratch> build` + `up -d`（镜像 researchmap:0.1，
  healthcheck 转 healthy）→ `/healthz`、静态首页、`session` →
  CLI 创建项目、`commit --dry-run`、提交 `node.create`、读回节点与
  `graph` → `tools/backup.py backup --db /data/researchmap.db --out …
  --json`（db+sql+json 三份副本，integrity ok）→ 重启容器数据仍在
  （卷持久化）→ `down -v` 清理。演练用独立 `-p` 项目名与 `RESEARCHMAP_PORT`
  临时端口，未触及已有数据卷和本机 8000 的开发服务器。两个注记：
  compose 对每个子命令都要能取到 `RESEARCHMAP_TOKENS`（插值先于命令）；
  `docker compose run` 里 `--json` 的 `RESEARCHMAP_BASE_URL` 要指向
  服务名 `http://researchmap:8000`——run 容器内 127.0.0.1 是它自己。
- 其余验收均已实跑：后端 61/61 冒烟、前端单测 95/95（A+B 新增
  viewPrefs/i18n/expandTools/detailLevel/双模式 layout 等套件）、
  1104 节点压测双模式（见 §15 计时；0.1 期的 4104 操作/87 提交/2.3 s
  压测仍有效）、浏览器 E2E 39/39（playwright，生产形同源部署下，
  含 collab/bigmap/layouts 等全套）、备份/恢复演练、独立 terminal
  的 AI 会话实录。