# 模拟独立终端 AI 会话实录（Phase C）

本文件记录一次**从零进入**的 AI 会话：外部 AI 只在另一个终端里持有
`docs/AI_USAGE.md` 与 `tools/researchmap.py`，不碰浏览器、不碰数据库文件，
通过 HTTP 读图、规划、提交、处理冲突、重放，全程与研究者的浏览器编辑交错。

| 项 | 值 |
|----|----|
| 服务器 | scratch uvicorn：`127.0.0.1:8123`，DB 在 `/tmp/rm-sim/data.db`，令牌仅存内存 |
| AI 令牌 | `ai-sim-token-0001`（环境变量 `RESEARCHMAP_TOKEN`；v0.1 无项目级白名单，所有有效令牌同处一个受信任空间） |
| 研究者令牌 | `researcher-token-0001`（用于并发竞争演示） |
| 项目 | `72da1aff-b001-4015-b4cf-e4d3fd2d6e28`（`create-project` 生成） |
| 示例提交文件 | `examples/skeleton.json`、`examples/ai-attempt-red.json`、`examples/researcher-interlude.json`、`examples/ai-continue.json` |

文中所有命令**均为实际执行**，输出为真实返回的节选（`…` 表示删减）。

> **2026-09-14 A05 复核**：CLI 的身份字段（`request_id` /
> `expected_revision`）改为**持久化进提交文件**、错误输出改为单一结构化
> JSON 对象后，本文件的相关场景在新 scratch（`127.0.0.1:8131`，项目
> `c7592461-…3148`）重跑了一遍。凡标 *（A05 复核重跑）* 的输出片段为
> 当日重跑的真实输出；未标注的节选仍是原会话（8123）的真实记录。

## 时间线（按 revision）

| rev | actor | summary（截短） |
|----|-------|----------------|
| 1 | researcher | 搭好项目骨架：两条一级路线 + 一条关键问题 + 一个候选协议 |
| 2 | ai-sim | AI 续做：140 ℃ 直接程序失败（成核过早），红记入图并关联问题节点 |
| 3 | ai-sim | AI 续做：给问题节点挂上（开题）进展 + 新想法：梯度降温后蒸发 |
| 4 | researcher | （模拟并发）研究员手工补记：新增主线 C，并细化主线 A 摘要 |
| 5 | researcher | （研究员）主线 B 补充钝化体系候选 |
| 6 | ai-sim | AI 续做：给问题节点补上界界实验计划（旧版本 409 后重放成功） |
| 7 | ai-sim | 同一份 payload 用 409 未记录过的 request_id 正常提交 |
| 8 | ai-sim | 添加钝化路线的首个问题节点（随后原样重放，见 §4） |
| 9 | researcher | 补充下一轮判据（PL 恢复率 + 接触角双指标） |
| 10 | ai-sim | 旧版本 409 后保持原 request_id 重试成功 |
| 11 | researcher | 把 N11 摘要恢复到与图内进展一致（此前脚本误覆盖） |

此外：一次 **422** 被拒提交（未产生 row）与两次 **IDEMPOTENCY_KEY_REUSED**
见文内 §3、§4。

---

## 1) 会话开场：身份与首读

凭证只走环境变量（CLI 不提供 `--token`，令牌不得出现在 argv/文件/日志）：

```console
$ export RESEARCHMAP_BASE_URL=http://127.0.0.1:8123
$ export RESEARCHMAP_TOKEN="ai-sim-token-0001"     # （A05：不再有 --token）
$ python3 tools/researchmap.py health
$ python3 tools/researchmap.py session
{ "actor": "ai-sim-token-0001", "app_version": "0.1.0" }
   # （A05 复核重跑核对过响应形状：actor = 服务器端配置的令牌名，app_version 为版本号。）
```

注意 `session` 只回 **actor（= 令牌名）与 app_version**——服务器端判定
身份；没有任何 `allowed_project_ids`/项目级授权的字段（v0.1 不存在项目
级 403，见 `docs/AI_USAGE.md` §1.1）。

```console
$ python3 tools/researchmap.py context 72da1aff-b001-4015-b4cf-e4d3fd2d6e28 \
      --focus a1000000-0000-4000-8000-000000000011 --max-chars 12000
# A05 复核重跑时 --node 与 --focus 等价（规格别名）；--format markdown 另有人读视图
```

节选该响应（此时 `project_revision = 11`，`truncated: false`，`omitted_counts: {}`）：

```json
{
  "focus": {
    "id": "a1000000-0000-4000-8000-000000000011",
    "title": "成核温度下界是多少？标志是什么？",
    "kind": "question", "status": "进行中",
    "summary": "已由 exp-112 确认 140 ℃ 段成核过早；下界定界实验排至 110–130 ℃ 三点",
    "tags": "成核, 温度窗口"
  },
  "ancestor_path": [ { "id": "…0001", "title": "主线 A：溶剂热工艺窗口", "status": "进行中" } ],
  "related_nodes":  [ { "id": "…0021", "title": "140 ℃ 直接程序（5 h）：成核过早",
                        "relation_kind": "supports", "side": "对方→本节点", … } ],
  "prior_attempts": [ { "id": "…0021", "status": "当前条件下不支持", … } ],
  "open_nodes":     [ { "title": "判据升级：PL 恢复率 + 接触角双指标" },
                      { "title": "接触角与 PL 恢复率哪个更先响应钝化度？" } ],
  "recent_changes": [ { "revision": 10, "actor": "ai-sim", "summary": "…" }, …共 5 条 ]
}
```

注意 `related_nodes` 里的负结果带着 `relation_kind`/`side`/`reason`：AI 在
换上下文之前**看见了之前的失败与它的来路**——这正是本产品的核心假设。
`side` 以**焦点节点**为本位：关系从 …0021（失败尝试）指向 …0011（焦点），
故为「对方→本节点」（A05 复核重跑时按同一条关系核对了该方向）。

命中 0 的关键词也不会被谎报为“从未尝试”（`warnings` 会给出限定语）。

## 2) 读全图与搜索（确定性端点）

```console
$ … graph 72da1aff-…        # 未归档节点：id/parent_id/order_index/…
$ … search  72da1aff-… 成核
{ "query": "成核", "total": 4, "items": [
    { "id": "a1000000-…0021", "title": "140 ℃ 直接程序（5 h）：成核过早",
      "matched_fields": ["title","tags","finding"],
      "path": [ { "title": "主线 A：溶剂热工艺窗口" },
                { "title": "120–140 ℃ 梯度升温程序" },
                { "title": "140 ℃ 直接程序（5 h）：成核过早" } ] },
    { "id": "a1000000-…0011", "title": "成核温度下界是多少？标志是什么？", … }, … ],
  "has_more": false }
```

`path` 是到根的一级链条，AI/人可以判断节点在哪个分支、处于什么上下文。

## 3) 红状态硬门槛（422 STATUS_EVIDENCE_REQUIRED）

AI 想把一次失败记为“当前条件下不支持”，但漏填了 `decision` 与 `evidence`：

```json
{
  "op": "node.create", "id": "a1000000-…0024", "kind": "attempt",
  "status": "not_supported",
  "summary": "两批次均出现二次成核，主相偏低",
  "scope": "135 ℃ × 5 h，乙二醇/水 2:1",
  "finding": "XRD 主相 45–60%；SEM 次级晶核团簇"
}
```

服务器：

```json
422 { "code": "STATUS_EVIDENCE_REQUIRED",
      "message": "状态为 不支持 时，scope/finding/decision 必须非空且至少一条证据",
      "details": { "missing": ["decision", "evidence"], "operation_index": 0 } }
```

**没有任何 row 产生。**（A05 合同下 CLI 以**退出码 3** 结束，stderr 是
§5 同款的单一 JSON 对象；422→3、409→2、网络/5xx→4、其余非 2xx→5。）AI
补齐 `decision`（“放弃该单段工艺，改梯度程序并复查 120–130 ℃ 下界”）与
`evidence`（XRD/SEM/附件）后重发同一 payload（新 request_id），成功——这
对应 rev2 的 `examples/ai-attempt-red.json`。

## 4) 幂等：原样重放 = 原回执；同 id 换内容 = 409

**a. 同文件字节级重放（合法幂等）**

`…/idem.json`（request_id `99999999-…`，`expected_revision: 8`，在 N…0003
下新增问题节点）第一次提交：

```json
{ "commit_id": "848f616e-…", "revision": 8, "base_revision": 7,
  "already_committed": false, … }
```

机器网络抖动导致 AI 客户端重发**同一文件**：

```json
{ "commit_id": "848f616e-…", "revision": 8, "base_revision": 7,
  "already_committed": true, … }
```

同一 `commit_id`、同一版本、`already_committed: true`，且重放后项目 revision
仍为 **8**（不重复生效）。

**b. 同一 request_id 换内容（拒绝）**

rev6 已记录的 request_id `8888…`，把其中任一字段改动后再提交：

```json
409 { "code": "IDEMPOTENCY_KEY_REUSED",
      "message": "该 request_id 已被不同的提交内容使用",
      "details": { "existing_commit_id": "16abc295-…" } }
```

两条判定都基于 `request_hash = sha256(canonical body)`，canonical 覆盖
`expected_revision / summary / client_label / operations`。

**常见提问**：如果我用 `--auto-rev` 重试，`expected_revision` 变了，hash 是否
就“不同内容”了？——分两种情况：

- 之前那次**已经 commit 成功**：任何改动（包括只改 `expected_revision`）都会
  触发 `IDEMPOTENCY_KEY_REUSED`。重试成功过的提交请按原字节重放原文件，不要
  再“生成一次”——A05 之后 CLI 对文件里已存在的 `request_id` /
  `expected_revision` **绝不调用再生器**（`--auto-rev` 只在字段**缺失**时
  读取当前 revision 并**回写文件**；字段齐备时任何 CLI 路径都不会改它们）。
- 之前那次**只是 409 REVISION_CONFLICT**（未落 row）：复用原 request_id 完全
  合法，服务器不认得它。此时正确动作是**显式重写提交文件**（新的
  `expected_revision`、按重读结果合并 operations），然后原样重提——CLI 不会
  替你静默刷新文件里已持久化的 revision（防止“自动冲关”变成默认补术）。
  409 提示现位于 stderr JSON 的 `hint` 字段（结构化指引，不再有 JSON 之后的
  追加注释）。

## 5) 并行冲突：researcher 与 AI 同时编辑

```text
t0  AI 在 rev8 上读到项目，开始编辑……
t1  researcher 落在 rev9：新增“判据升级：PL 恢复率 + 接触角双指标”
t2  AI 落盘，expected_revision 仍是 8 →
```

```json
409 { "code": "REVISION_CONFLICT",
      "message": "项目版本不一致，请载入最新版本后重试（保持相同 request_id）",
      "details": { "expected_revision": 8, "current_revision": 9 } }
```

A05 复核重跑（stale `expected_revision=0`，当前 `current_revision=1`）时，
失败侧 CLI 向 **stderr** 写**恰好一个** JSON 对象（其后不追加散文），退出
码 **2**：

```json
{"ok": false, "error": {"status": 409, "code": "REVISION_CONFLICT",
  "message": "项目版本不一致，请载入最新版本后重试（保持相同 request_id）",
  "response": {"error": {"code": "REVISION_CONFLICT", "message": "…",
  "details": {"expected_revision": 0, "current_revision": 1}}}},
 "hint": "服务器版本已被推进；本次提交完全没有写入。请重新读取 context/"
 "commits 弄清谁改了什么，然后显式重写提交文件：把 expected_revision 更新为"
 "当前值并合并 operations 的冲突。409 未留下任何提交记录，因此保留原"
 " request_id 重提是合法的。CLI 不会替你刷新文件里已有 revision…"}
```

AI 标准动作（冲突=协作，不是绕行）：

```console
$ … commits <PID> --limit 5            # 看中间进了什么
$ … context --focus <节点> …           # 重读受影响的状态
$ # 显式重写 ai-stale.json：expected_revision → 当前值，operations 按重读合并；
$ # 409 未落 row，保留原 request_id 合法
$ … commit <PID> ai-stale.json         # 200，同一 request_id 卷回来
```

（原会话里这一步写作 `commit … --auto-rev`；A05 之后 `--auto-rev` 只负责
“缺失才准备”，文件里已有的 revision 不会被 CLI 触碰，刷新必须由你显式写入
文件——否则 409 会变成永远的“无谓重试”。）

```json
{ "commit_id": "8555f5a9-…", "request_id": "cccccccc-…0001",
  "revision": 10, "base_revision": 9, … }
```

**同 request_id 卷回来了**（409 未落 row，见 §4b），并发却没有数据丢失：
rev9 与 rev10 的两个节点各自保留在树上。

## 6) 提交第十七步细节

AI 查自己的提交 history：

```console
$ … commits --node a1000000-…0011 72da1aff-…
$ … commit-detail 72da1aff-… <commit_id>
```

`commit-detail` 给出 `operations_json`（原始 payload）与 `changes_json`
（实际落库变更），供人类审计。

---

## 本次会话修正的两个“疑似异常”（现已澄清）

初次测试时观察到“幂等重放报错 / 换内容竟然被接受”，逐条复核后均为**测试方法
误判**、服务器行为本身正确：

1. 用 `--auto-rev` 重放一个**已记录**的 request_id：`expected_revision` 被
   刷新，hash 变化 → 正确地按 `IDEMPOTENCY_KEY_REUSED` 拒绝（§4b）。
   （A05 之后 CLI 已不会代刷文件中已持久化的 revision，此误操作路径不复
   存在——身份字段一经存在绝不改动。）
2. 一个只产过 409（从未 commit）的 request_id 换内容再提：无 row 可查，
   相当于全新请求 → 正确地 200 接受（§4b 第二种情况）。

**期间修复/改动的 CLI 文档与行为**（服务器语义无改动）：

- 409 提示原为“用新的 request_id 重试”，与服务器“保持同一 request_id”
  冲突；已统一为“重读 → 显式重写文件 → 保留原 request_id 合法”。
- **A05 合同（2026-09-14）**：`request_id`/`expected_revision` 缺失时由
  CLI 生成并**回写进提交文件**（原子改写，人读提示走 stderr）；文件即
  可重放工件，同命令重复执行 = 逐字节重放 = 幂等。`--auto-rev` 语义收敛
  为“缺失才准备”；`--dry-run` 只加 `dry_run=true` 查询参数，从不写入文件。
- 失败输出一律是 **stderr 单个 JSON 对象** `{"ok": false, "error": {...},
  "hint"?}`；stdout 成功时恰好一个 JSON 对象。退出码 0/1/2/3/4/5 见
  `--help` 与 `AI_USAGE.md` §1.3。
- 凭证只走 `RESEARCHMAP_BASE_URL`/`RESEARCHMAP_TOKEN` 环境变量（令牌不再
  出现在 argv，`--token` 移除）；`RESEARCHMAP_URL` 作为 `RESEARCHMAP_BASE_URL`
  的回退别名。
- context 增加 `--format json|markdown`（默认 json；markdown 为人读视图，
  截断规则与 json 一致，含 omitted_counts/continuations 与 `node` 双读提示）；
  `--node`/`--query` 为 `--focus`/`--q` 的规格别名；export 的 `--output` 为
  `--out` 的别名。
- commit / create-project 的位置参数与 `--file` 严格“二选一”：同一文件给
  两遍（无论路径是否相同）也报 USAGE（退出码 1）——复核中发现双规格同值时
  曾被静默接受并真实落库，已修复。