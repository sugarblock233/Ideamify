# 模拟独立终端 AI 会话实录（Phase C）

本文件记录一次**从零进入**的 AI 会话：外部 AI 只在另一个终端里持有
`docs/AI_USAGE.md` 与 `tools/researchmap.py`，不碰浏览器、不碰数据库文件，
通过 HTTP 读图、规划、提交、处理冲突、重放，全程与研究者的浏览器编辑交错。

| 项 | 值 |
|----|----|
| 服务器 | scratch uvicorn：`127.0.0.1:8123`，DB 在 `/tmp/rm-sim/data.db`，令牌仅存内存 |
| AI 令牌 | `ai-sim-token-0001`（项目白名单 = 本项目） |
| 研究者令牌 | `researcher-token-0001`（用于并发竞争演示） |
| 项目 | `72da1aff-b001-4015-b4cf-e4d3fd2d6e28`（`create-project` 生成） |
| 示例提交文件 | `examples/skeleton.json`、`examples/ai-attempt-red.json`、`examples/researcher-interlude.json`、`examples/ai-continue.json` |

文中所有命令**均为实际执行**，输出为真实返回的节选（`…` 表示删减）。

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

```console
$ python3 tools/researchmap.py health --base http://127.0.0.1:8123
{"status": "ok"}   # （实际输出略）

$ python3 tools/researchmap.py session --base http://127.0.0.1:8123 --token ai-sim-token-0001
{ "token": "ai-sim-token-0001", "client_label": "ai-sim", "allowed_project_ids": [ "72da1aff-…d6e28" ] }
```

```console
$ python3 tools/researchmap.py context --base http://127.0.0.1:8123 \
      --token ai-sim-token-0001 72da1aff-b001-4015-b4cf-e4d3fd2d6e28 \
      --focus a1000000-0000-4000-8000-000000000011 --max-chars 12000
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
                        "relation_kind": "supports", "side": "本节点→对方", … } ],
  "prior_attempts": [ { "id": "…0021", "status": "当前条件下不支持", … } ],
  "open_nodes":     [ { "title": "判据升级：PL 恢复率 + 接触角双指标" },
                      { "title": "接触角与 PL 恢复率哪个更先响应钝化度？" } ],
  "recent_changes": [ { "revision": 10, "actor": "ai-sim", "summary": "…" }, …共 5 条 ]
}
```

注意 `related_nodes` 里的负结果带着 `relation_kind`/`side`/`reason`：AI 在
换上下文之前**看见了之前的失败与它的来路**——这正是本产品的核心假设。

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

**没有任何 row 产生。** AI 补齐 `decision`（“放弃该单段工艺，改梯度程序并复查
120–130 ℃ 下界”）与 `evidence`（XRD/SEM/附件）后重发同一 payload（新
request_id），成功——这对应 rev2 的 `examples/ai-attempt-red.json`。

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
  触发 `IDEMPOTENCY_KEY_REUSED`。重试成功过的提交请用原回执，不要再生成。
- 之前那次**只是 409 REVISION_CONFLICT**（未落 row）：复用原 request_id 完全
  合法，服务器不认得它。CLI 的 409 提示就是“重读后用 `--auto-rev` 重试，保留
  原 request_id”。

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

CLI 向 stderr 打印机器可读提示；AI 标准动作：

```console
$ … commits 72da1aff-…            # 看 rev9 是谁改了什么
$ … context --focus N11 …         # 重读
$ … commit 72da1aff-… ai-stale.json --auto-rev     # 同一 request_id，新 rev
```

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
2. 一个只产过 409（从未 commit）的 request_id 换内容再提：无 row 可查，
   相当于全新请求 → 正确地 200 接受（§4b 第二种情况）。

**期间修复的 CLI 文档/提示**（服务器自身语义无改动）：

- CLI 409 提示原为“用新的 request_id 重试”，与服务器“保持同一
  request_id”冲突；已统一为“重读 → `--auto-rev` → 保留原
  request_id”。见 `tools/researchmap.py` 的 `post()` 与模块 docstring。