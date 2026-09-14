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

## 尚未完成 / 未验证
- **仅一项未验证**：`Dockerfile` + `compose.yaml` + `.env.example`
  已写好，但本开发环境没有 docker，`docker compose build` 未执行。
  用户侧一条命令：`cp .env.example .env`（改两个令牌）后
  `docker compose up -d --build`，访问 http://localhost:8000/。
- 其余验收均已实跑：后端 61/61 冒烟、前端 32/32 单测、1000+ 节点
  压测（4104 操作/87 提交/2.3 s，结构断言全过）、浏览器 E2E
  4/4（playwright，生产形同源部署下）、备份/恢复演练、独立
  terminal 的 AI 会话实录。