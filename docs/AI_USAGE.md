# AI_USAGE — 外部 AI 如何在独立终端读取并提交科研地图

你（一个外部 AI）与研究者共用同一个 **ResearchMap** 服务器。你不需要、也不应该
访问文件、数据库或 Web 会话；你只需要 **一个访问令牌** 和 `tools/researchmap.py`
（纯标准库 Python，无第三方依赖）。所有写入最终都落在同一个提交端点上，
冲突规则与 Web 界面完全一致。

## 0. 前置

```bash
export RESEARCHMAP_BASE_URL=http://<server>:8000     # 默认 http://127.0.0.1:8000
export RESEARCHMAP_TOKEN=<研究员发给你的访问令牌>
RM="python3 /path/to/researchmap.py"
$RM health            # 无需令牌，确认服务器可达
$RM session           # 确认你的身份（actor 由令牌决定，无法伪造）
```

常用读取命令：

| 命令 | 说明 |
|---|---|
| `$RM projects` | 项目列表（id/名称/目标/当前 revision） |
| `$RM project <PID>` | 项目元信息 + 当前 `revision`（乐观锁基线） |
| `$RM context <PID> [--focus <NODE>] [--q 关键词] [--max-chars N]` | **首要读取入口**：预算化上下文（见下） |
| `$RM graph <PID> [--json]` | 主树全部未归档节点（layout 输入：parent_id/order_index） |
| `$RM node <PID> <NODE>` | 单节点完整内容 |
| `$RM relations <PID> <NODE> [--include-archived] [--cursor C]` | 节点关联（每页 20） |
| `$RM search <PID> "…" [--limit N]` | 搜索（标题/摘要/标签/观察/结论，中文子串可用） |
| `$RM commits <PID> [--node NODE] [--limit N]` | 提交历史（谁在何时改了什么、为什么） |
| `$RM commit-detail <PID> <CID>` | 单个提交的逐字段 diff |
| `$RM export <PID> --out map.json` | 全量导出（含归档与历史），交接快照 |

## 1. 读：先问 context，再定点读

`context` 是唯一会“替你读”的端点：它按 **字符预算**（`max_chars` 4000–50000）
装进当前任务需要的内容，规则是：

- **骨架优先**：项目目标、焦点节点与全链祖先的 `id+标题` 一定完整（不截断）。
- `--focus <NODE>`：注入该节点的 `scope/summary/finding/decision/tags` 全文，
  直接关联（反证 `contradicts`／依赖 `depends_on` 优先），同分支先前的
  `not_supported`/`inconclusive` 记录，以及待探索的子节点。
- `--q 关键词`：全局预算关键词检索（含观察/结论字段），每条带节点坐标。
- 超预算会被截断并给出 `truncated=true` 与 hints——**看 hints 再缩小范围**
  （换更聚焦的 focus、减小展开量），而不是盲目重试。

截断前请确认：`project_revision`（你提交时的 `expected_revision` 基线）、
focus 与各节点的完整 id。历史 `commits` 用来判断“这件事谁推进到哪一步了”，
对续做上一段中断的探索尤其重要。

## 2. 写：一次 commit，一批 operation，原子生效

写入的唯一入口是 `POST /api/v1/projects/{PID}/commits`，通过 CLI：

```bash
$RM commit <PID> ops.json --auto-rev        # 自动取当前 revision
$RM commit <PID> ops.json --dry-run         # 先演练：全量校验，不落库
$RM commit <PID> ops.json                   # 正式提交
```

`ops.json` 是完整 CommitRequest 主体（`--auto-rev` 时 revision 可省略）：

```json
{
  "request_id": "b1f8c2a0-1111-4abc-9def-222233334444",
  "expected_revision": 17,
  "summary": "在乙二醇溶剂热体系下考察成核窗口，新增一条失败实验记录",
  "operations": [
    {
      "op": "node.create",
      "id": "d41d8cd9-8b0d-4a99-8e9e-4a9f0b3c1101",
      "parent_id": "9a0369f6-c9b7-4b3c-bc9f-51b8a1de2f10",
      "kind": "attempt",
      "title": "120 ℃ / 5 h 溶剂热：成核过早",
      "summary": "再现率低，形貌为次级晶核堆积",
      "status": "not_supported",
      "scope": "乙二醇前驱体、常规高压釜、120 ℃ / 5 h",
      "finding": "5 h 内观察到二次成核",
      "decision": "该工艺窗口放弃，作为负结果保留",
      "details_md": "## 条件\n- 120℃，5 h，…\n\n## 观察\n…",
      "tags": ["溶剂热", "成核"],
      "evidence": [
        { "kind": "inline", "label": "XRD", "value": "二次峰 18.3°", "note": "见附件 3" },
        { "kind": "path", "label": "图像", "value": "runs/exp-112/semed-*.png" }
      ]
    },
    {
      "op": "relation.create",
      "id": "00000000-0000-4000-8000-000000000002",
      "source_id": "9a0369f6-c9b7-4b3c-bc9f-51b8a1de2f10",
      "target_id": "d41d8cd9-8b0d-4a99-8e9e-4a9f0b3c1101",
      "kind": "supports",
      "reason": "该失败实例支持“成核过早”这一分支判断"
    }
  ]
}
```

要点：

- **id 由提交方提前生成**（UUID）。重放同一 `request_id` 时服务器返回当初的
  回执，绝不写两次（幂等）。
- **一个请求 = 一个原子变更集**：要么全部生效，要么全不生效；失败时
  `details.operation_index` 告诉你是第几个 op 的问题。
- **乐观锁**：`expected_revision` 必须等于当前 revision；不匹配 →
  `409 REVISION_CONFLICT`（`details.current_revision` 给出新号）。
  正确做法：重新 `context`/`commit-detail` 看清谁先写了什么，**调整计划并
  换新 request_id** 重试。
- 提交成功后响应含 `commit_id` 与新的 `revision`，可直接作为下一次写入的
  `expected_revision`。

### operation 一览

| op | 必填 | 语义 |
|---|---|---|
| `node.create` | `id, kind, title`（外可加 `summary/status/scope/…/tags/evidence/parent_id/after_id`） | 新节点。`kind` ∈ question/idea/attempt/finding；`status` ∈ unexplored/in_progress/promising/supported/not_supported/inconclusive |
| `node.update` | `id, fields{…}` | **部分更新**：只写 `fields` 里显式给出的字段；显式 `null` 视同未提供 |
| `node.move` | `id`，外可加 `parent_id`、`after_id` | 改归属/同组排序。`after_id` **省略**=移到末尾；**显式 `null`**=移到该父级下首位 |
| `node.archive` / `node.restore` | `id, reason(1–500)` | 归档仅叶子（后端有子节点直接 422）；恢复后重新入图 |
| `relation.create` | `id, source_id, target_id, kind, reason(1–500)` | 跨分支关联，`kind` ∈ related/motivates/supports/contradicts/depends_on；**方向 = source→target** |
| `relation.update` | `id, fields{kind,reason}` | 改类型或原因 |
| `relation.archive` / `relation.restore` | `id, reason` | 归档/恢复关联关系 |
| `project.update` | `fields{name, objective}` | 仅项目名称与总目标 |

### 硬约束（后端会 422）

- **红状态必须带证据**：`status=supported/not_supported` 时 `scope/finding/
  decision` 必须非空且 `evidence ≥ 1`（否则 `STATUS_EVIDENCE_REQUIRED`，
  `details.missing` 列出缺口）。更新时按**合并后**的字段判断——因此不能
  用 update 把红记节点改回蓝而不先补齐。
- 主树深度上限；父节点不能归档；不能成环（move 到自己的子孙下）；
  归档节点要 `node.restore` 后才能再被引用为 parent。
- 关联不允许自环；原因必填。
- `id/parent_id/source_id/target_id/request_id` 均为 UUID，任何未知字段都会
  被 422 拦下（不静默吞掉你的拼写错误）。

## 3. 心法

1. **先读后写**：动笔前 `context --focus <你续做的节点>`。
2. **小步提交**：一次探索增量一个 commit，`summary` 用研究者也能看懂的一句话
   说明“是什么（不是做什么）”。
3. **失败也是资料**：失败/搁置的尝试用 `not_supported`/`inconclusive` 记录——
   带 scope+finding+decision+证据，这是别人（包括未来的你）不下重蹈的最大价值。
4. **冲突就重读**：`REVISION_CONFLICT` 是协作信号，不是错误。重看 `commits`
   近几条，想清楚再动，而不是原地重试。
5. **不改别人没让你改的**：只在与你当前任务相关的分支上写；挪动/重排别的
   分支节点前，先确认 researcher 是否同意。
6. **交接用 export**：会话结束前 `$RM export <PID> --out handoff-<rev>.json`。

## 4. 错误指针（ErrorCode → 你该做什么）

| code | 含义 | 动作 |
|---|---|---|
| `VALIDATION` (422) | 字段/取值不合法 | 按 `details`（含 `operation_index`）改 ops |
| `STATUS_EVIDENCE_REQUIRED` | 红记证据不齐 | `details.missing` 列出缺哪些，补齐再提 |
| `REVISION_CONFLICT` (409) | 他人先提交 | 重新 context → shift plan → 新 request_id 重试 |
| `IDEMPOTENCY_KEY_REUSED` (409) | request_id 复用但内容不同 | 换新 request_id（想重放幂等就保持 body 完全一致） |
| `NOT_FOUND` (404) | 项目/节点/提交不存在 | 先 `$RM projects` 核对 PID |
| `FORBIDDEN` (403) | 令牌未放行该项目 | 向 researcher 要对应项目的令牌 |
| `ID_TAKEN` | 节点 id 已被占用 | 换一个新 UUID |
| `MOVE_CYCLE` / `PARENT_ARCHIVED` / `ARCHIVE_HAS_CHILDREN` | 树结构约束 | 先归档/搬离子节点，或换父级 |