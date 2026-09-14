# 第二轮验收整改结果 — ResearchMap（Ideamify）2026-09-14

本文件对应**第二轮**审查报告 `docs/acceptance-2026-09-14/REPORT.md`（下称"报告"）。
报告的条件是"逐项修复并用真实命令/截图重新验证"，并明确驳回了第一轮"已修复且验证"的结论：
第一轮把"编译通过/文件就绪"当成"浏览器验证通过"，其中 3 个 P1 产品缺陷在真实环境可复现。
因此本文件**不再沿用第一轮的自评**：每一条 R 项都给出本轮真实执行过的复现命令与实测结果；
未跑过的一律写"未验证/待远端权限"，不写"本地等价物全绿"。
（所有者在本机装好 Docker 后，本节关于容器的部分已从"未验证"改为**本机实测**，见 §2.1；
此后所有者又授权 push，远端 CI 已真跑一次并 5/5 全绿，见 §4。两次追加都在下文逐条改判，
每条都给出实际执行过的命令与读回的远端事实。）

状态只使用五种：**已修复且验证／已实现未验证／待所有者决定／待远端权限／未完成**。

> 说明：`docs/acceptance-2026-09-1{3,4}/`（含本轮报告与用户原件）保持 **untracked、未提交**；
> 本文件是仓库内唯一对外的整改记录。

---

## 1. 运行环境与数据隔离

| 项 | 值 |
|---|---|
| 系统 | macOS Darwin 25.6.0（本地）；CI 基线 ubuntu-latest / Node 22 / Python 3.13 |
| 本地 Node | v24.10.0（**与 CI 基线 22 不同**，未消差；见 §6-1） |
| Docker | Docker 29.4.0 + Compose v5.1.2（**本轮由所有者新装**，此前本机无 Docker）；镜像 `researchmap:0.1`，compose 项目 `betterairesearch` |
| Python | 3.13.5（`backend/.venv`） |
| 浏览器 | Playwright Chromium（headless，本机缓存） |
| E2E 服务器 | 生产形同源：`uvicorn app.main:app` + 预构建 `dist/`，127.0.0.1:8021，库为每次新建的 `mktemp -d` scratch |
| 压测读数服务器 | 127.0.0.1:8126（对 `/tmp/rm-stress/data.db`，1104 节点 / 3000 关系） |
| 数据库 | 全部为临时/合成库：`E2E_DB_DIR=$(mktemp -d)`、`/tmp/rm-stress`、`/tmp/rm-smoke*`、容器演练卷 `rm-d03-restore`（全新创建，演练后删除）。交付前清理 |
| 真实数据 | **未触碰**。所有写入都指向临时库与合成卷；令牌全为合成值（`e2e-*`/`e2e-other-*`/`researcher-*`/`stress-*`/`container-token-*`） |
| 提交署名 | 全仓提交**不带** `Co-Authored-By` 尾注（遵守本仓 `AGENTS.md:94`）：本轮 12 个提交本就没带，存量 15 个已由所有者决定并**改写清除**（见 §3-9、§5-7） |

---

## 2. 本轮逐项结果（R01–R10）

| 项 | 状态 | 提交 | 复现命令 / 场景 | 实际结果 | 剩余限制 |
|---|---|---|---|---|---|
| **R01** 退出不确认导致草稿丢失 | 已修复且验证 | `79169d8` | `E2E_DB_DIR=$(mktemp -d) npx playwright test e2e/collab.spec.ts -g "离开确认"` | 统一 `confirmLeaveDraft()` 后，「退出」与「+ 项目」两条真正的离开路径都先弹确认；取消 → 留在原项目、草稿逐字不变、不弹建项目弹窗；确认 → 回到令牌闸门。同一 e2e 用例覆盖三个分支 | 「切换节点/关闭面板」沿用原有 `guardLeave` 文案，未额外重复断言（同一函数） |
| **R02** 同字段冲突缺三方比较 + 刷新静默吞冲突 | 已修复且验证 | `79169d8`、`d98d809` | ① `npx vitest run src/lib/__tests__/merge.test.ts`（11 用例）② `npx playwright test e2e/collab.spec.ts -g "A02 同字段并发"` ③ 同文件 `-g "syncAll"` | 409 后逐字段展示 **读取时 / 你的草稿 / 服务器** 三栏 + 「保留我的／采用服务器／我自己合并」；未处理时「保存」禁用。**本轮新发现的同类缺陷**：提交成功后的 `syncAll` 会按新基线重新合并，于是"用户看过但没答复"的冲突不再像冲突 —— 列表被静默清空、保存重新可用，一键即覆盖队友提交。新增 `preserveUndecided()` 保留未处理项（服务器列刷新为当前值），并新增 e2e 走真实可达路径：编辑 → 他人提交 → 载入更新出现三方比较 → 做一次无关的成功提交（触发 syncAll）→ 冲突仍在。**反向验证**：把 `preserveUndecided` 的未处理项参数置空并重新构建 → 该用例在第 411 行 `toHaveCount(1)` 收到 0 而失败；恢复后通过 | 「载入更新」的触发在 e2e 中由派发真实 `focus` 事件驱动（等价于用户切窗回来），未等 20s 轮询 |
| **R03** 大图首屏不可读 + MiniMap 空白 | 已修复且验证 | `693caef`、`f8a178a`、`36a3239` | `python3 scripts/stress_test.py` 造 1104 节点库 → 8126 起全形 uvicorn → `cd frontend && RESEARCHMAP_BASE_URL=http://127.0.0.1:8126 RESEARCHMAP_TOKEN=stress-token-0001 node ../scripts/measure_firstopen.mjs <pid> 1440 900`（脚本已入库） | 放弃"整体包围盒硬 fit + 0.4 地板"，改为**锚定根节点 + 固定可读缩放 0.7**。1104 节点实测（本轮构建）：zoom **0.7**（报告基线 0.4）、卡片渲染宽 **196px**（基线 112px）、标题渲染字号 **9.8px**（基线 ≈5.6px）、1440×900 **8 张卡完整入屏**（1280×800 为 7 张）、首卡 274–357ms、104 卡 / 104 个折叠徽标。截图 `docs/evidence/a03-stress-1104-firstopen-{1440x900,1280x800}.png` 目视为可读。MiniMap：查得真因是**受控 `nodes` 未写 `node.measured`**（未传 `onNodesChange`），补 `width`/`height` 后恢复渲染；实测右下角已画出节点与视口矩形（1104 节点图是单列长条，故形态退化为一条竖线，不是空白） | 「首屏可读」由脚本读数 + 截图目视确认，未做 OCR 级断言；大图 e2e 用 50×2 节点小图断言卡宽阈值（快、稳），1104 级读数靠上表脚本 |
| **R04** E2E 未全绿（10 passed / 2 failed） | 已修复且验证 | `f865f9f`、本轮新增用例 | `E2E_DB_DIR=$(mktemp -d) npx playwright test`（连续三次全新库） | 报告的两个失败根因均已按 R04 禁令修掉（不用 force click / 不加 timeout / 不跳过）：① `collab.spec.ts` 的 `getByText("三层C")` 同时命中卡片、面包屑与 `h2` → 改为按容器限定（`.rm-card` / `h2`）；② `acceptance.spec.ts` 的右键不稳定 → 改为先 `toBeInViewport()` 再操作。结果：**19/19**，三次连跑 18.0s / 17.3s / 17.9s 全绿 | **残余不稳定（如实记录）**：本轮中间状态曾出现 **1 次** `A07 节点深链接` 偶发失败（当时报错文本未留存）；随后 43 次全量/单文件连跑（均全新库）没有再复现。未按"加大 timeout"掩盖，标记为**已知残余风险**；补验：CI 连续 20 次绿后撤销该标记 |
| **R05** 最终 context 可能超字符预算 | 已修复且验证 | `e43c892` | `backend/.venv/bin/python -m pytest backend/tests -q`；明细见 `backend/tests/api_smoke.py` 的 A04-a/b/c 三段 | 预算检查移到**所有元数据（warnings/continuations/omitted_counts）写完之后**并对最终响应体重测：`A04-a: focus@4000 final size within budget`（compact ≤ 4000 且 meta 非空）、`A04-b` 省略项 → `truncated=true`、`A04-c` 唯一 q 命中优先、`context over-budget required-skeleton -> 422 CONTEXT_BUDGET_TOO_SMALL` | 无 |
| **R06** 便捷模式首次失败 stderr 不是单个合法 JSON | 已修复且验证 | `0000276` | `backend/tests/test_cli.py::test_first_failure_after_identity_writeback_is_one_json_object`（真实起 scratch 服务器） | 身份回写提示改为**缓冲**：成功后才打印，失败时并入同一个错误对象（`notes` 字段）。该用例断言"文件被回写身份字段后 POST 故意失败"时 stderr 整体可 `json.loads` 为**恰好一个**对象 | 交互式真人手敲路径未逐条重放（用例走的是同一 CLI 入口） |
| **R07** Markdown context 丢字段 + 无 data_notice | 已修复且验证 | `0000276` | `backend/tests/test_cli.py::test_markdown_keeps_analysis_fields_of_every_item`、`::test_markdown_keeps_notice_truncation_and_continuations` | 抽出的 `_append_analysis_fields()` 现在对 `related_nodes`/`prior_attempts`/`open_nodes`/`routes`/`recent_findings`/`matched` 的**每一条**也打印 scope/finding/decision（存在才打印），并在 markdown 输出补 `data_notice`；截断标记与续读指引保持 | `--max-chars` 只约束底层 JSON、markdown 是纯渲染 —— 已写入文档而不是改行为 |
| **R08** 不可执行/错误的契约文案 | 已修复且验证 | `4d3668f` | README 命令逐条真跑：`python3 tools/backup.py backup --db … --out …` → `python3 tools/backup.py verify ./backup/researchmap-<ts>.db` | ①`verify` 用法改为位置参数（`--db` 形式复现为 exit 2 `unrecognized arguments`，改后真实跑通）；②`AI_USAGE.zh-CN.md` 的 `--dry-run` 说明已改为实情（"只让服务端不落库；若提交文件缺 `request_id`/`expected_revision`，CLI 在任何模式下都会回写"）；③AI 接入弹窗改为可直接粘贴的命令（给出真实项目 id，去掉 `[--foo <占位>]` 伪语法），409 说明点明四种 code（`REVISION_CONFLICT` 锁的是**整个项目的版本**，非"同一对象"） | 弹窗文案由 e2e「B06」逐字断言关键片段（四种 code 全列、真实 pid、无方括号占位） |
| **R09** `implementation-results.md` 与实况不符 | 已修复且验证 | 本文件 | 逐条对照仓库实况复核 | 全篇重写；第一轮的错误结论在 §3 逐条更正（含 E2E 数字、容器 job、模板数量、不存在的 `WORKSPACE.md`/`PROTOCOL.md`）。**当时**远端状态类条目一律标"未验证/待所有者操作"；所有者授权后这些条目已由 §9 的实测结果替换 | 无（远端事实已从"读不到"变为"已读回核对"） |
| **R10** GitHub 维护约定未完成项 | 已修复且验证 | `b4947d4`、`88346ee` | ①`grep -n "uses:" .github/workflows/ci.yml` ②本地跑 credential-scan 片段（含假凭证的临时文件）③`git log` 审署名 | ①4 个 action 全部钉到**经 API 核对**的 40 位 SHA + 版本注释（checkout v4.4.0、setup-node v4.4.0、setup-python v5.6.0、upload-artifact v4.6.2）；②credential-scan 改为**只报"文件:行号"**，日志不再回显匹配文本（假凭证实测：日志只出现路径与行号）；③`markdown-link-check` 文件列表补上 `docs/AI_USAGE.zh-CN.md`；④本轮提交不再带 `Co-Authored-By` | **远端已跑通**：首次 push 后 5 个 job 全绿（见 §4）。存量 15 个提交的尾注已按所有者决定**全部改写清除**（含已公开初版），详见 §3-9、§5-7、§9 |

---

## 2.1 容器项 D01–D03（所有者新装 Docker 后本轮实测）

第一轮/第二轮报告都把容器标为"未验证"。所有者此后在本机装了 Docker（29.4.0 +
Compose v5.1.2），所以这一节全部是**本机真实容器**上跑出来的，命令可原样复现。
数据自始至终是合成演练数据（令牌 `container-token-0001`、项目"容器演练项目"），
**没有触碰任何真实库**；演练用的卷 `rm-d03-restore` 与临时文件已在 §8 清理。

| 项 | 状态 | 复现命令 / 场景 | 实际结果 | 剩余限制 |
|---|---|---|---|---|
| **D01** Compose 默认仅绑定回环 | 已修复且验证 | `RESEARCHMAP_TOKENS='{…}' RESEARCHMAP_PORT=8022 docker compose config`；`docker port betterairesearch-researchmap-1` | 展开配置为 `host_ip: 127.0.0.1`、`published: "8022"`、`target: 8000`；`docker port` 实测 `8000/tcp -> 127.0.0.1:8022`（独立实例同为 `127.0.0.1:8023`）。**容器内** uvicorn 仍监听 `0.0.0.0:8000`（容器边界内），与宿主发布地址是两件事 | 远程访问仍由部署者自行加受保护网络/HTTPS 代理，项目不代改 SSH/防火墙/隧道 |
| **D02** 构建上下文干净、锁文件生效 | 已修复且验证 | `docker history --no-trunc researchmap:0.1 \| grep -ci 'token-'`；`docker run --rm researchmap:0.1 sh -lc 'env \| grep -i researchmap; find / -name "*.db" …'` | 镜像历史里**零**令牌字样；镜像内 `RESEARCHMAP_*` 只有路径变量（`RESEARCHMAP_DB`/`RESEARCHMAP_STATIC`），**没有任何令牌**；镜像内搜不到 `.db` 文件。`.dockerignore` 排除 `.git`/`node_modules`/`backend/.venv`/`*.db`/`*.db-wal`/`*.db-shm`/`backup(s)/`；镜像按 `requirements.lock.txt` 装、前端用 `npm ci` | 运行用户仍是 root（未改非 root，故不涉及既有卷权限变更）；Node 基线 22 与本地 24 的差异仍在 §6-1 |
| **D03** 生产持久化路径 | 已修复且验证 | 见下方"演练序列" | 构建→启动→鉴权→建项目→深链接→**备份→恢复→重建**全链路通过；`restart` 与 `up -d --build` 后 revision/nodes/commits 均不变（1/3/1）；备份产物单文件 98 KB、`verify` 通过、主机侧 `show` 可读；恢复后 revision 从 2 回到 1、演练新增节点消失；**独立实例**（全新卷 + 仅用备份文件，8023）读出 revision=1 / nodes=3 / commits=1 与同一条 summary，深链接 200、无令牌 401 | v0.1 不做在线热替换，恢复必须 `docker compose stop`；Windows 11 / podman 未验证 |

### D03 演练序列（全部为真实执行过的命令）

```bash
export RESEARCHMAP_TOKENS='{"container":"container-token-0001"}' RESEARCHMAP_PORT=8022

# ① 天真做法 → 本轮新发现的静默丢数据陷阱（详见 §6 计划外缺陷 A）
docker compose cp researchmap:/data/researchmap.db /tmp/rm-d03/naive.db   # 4096 字节
python3 tools/backup.py verify /tmp/rm-d03/naive.db                      # 缺表 → exit 1

# ② 正确备份（服务不停；Online Backup API 对 WAL 安全）
docker compose run --rm -v "$PWD/tools:/tools:ro" researchmap \
  python /tools/backup.py backup --db /data/researchmap.db --out /data/backups
docker compose cp researchmap:/data/backups/researchmap-<ts>.db ./backup/
python3 tools/backup.py verify ./backup/researchmap-<ts>.db   # counts = 1/3/0/1

# ③ 制造"恢复后应当消失"的改动（revision 1 → 2，新增一个节点）
#    POST /api/v1/projects/<pid>/commits（合成）

# ④ 恢复
docker compose stop
docker compose cp ./backup/researchmap-<ts>.db researchmap:/data/restore-source.db
docker compose run --rm -v "$PWD/tools:/tools:ro" researchmap \
  python /tools/backup.py restore --src /data/restore-source.db \
    --dst /data/researchmap.db --server-stopped --yes
docker compose start
# → 旧库留档 researchmap.db.pre-restore-<ts>；清理 -wal/-shm；revision 回到 1、3 节点

# ⑤ 重启与重建后数据仍在
docker compose restart && docker compose up -d --build   # 两次后仍是 revision=1 / 3 节点

# ⑥ 独立实例核对（全新卷，只用备份文件）
docker volume create rm-d03-restore
docker run --rm -v "$BK":/src-backup.db:ro -v rm-d03-restore:/data researchmap:0.1 \
  sh -lc 'cp /src-backup.db /data/researchmap.db'
docker run -d --name rm-d03-restored -p 127.0.0.1:8023:8000 \
  -e RESEARCHMAP_TOKENS='{"container":"container-token-0001"}' \
  -v rm-d03-restore:/data researchmap:0.1

# ⑦ 真实浏览器（不是 curl 了事）：闸门 → 画布 → 深链接选中
RESEARCHMAP_BASE_URL=http://127.0.0.1:8023 RESEARCHMAP_TOKEN=container-token-0001 \
RESEARCHMAP_SHOT=/tmp/rm-d03/container-restored-instance.png \
  node scripts/verify_container.mjs <pid>
# → revision=1 / nodes=3 / cardsOnCanvas=2 / detailVisible=true / consoleErrors=[]
```

截图 `docs/evidence/d03-container-restored-1440x900.png` 就是 ⑦ 的画面：顶栏显示
**项目 v1**，画布上是"容器演练项目"虚拟根 + 两条一级/二级节点，右下 MiniMap 有内容，
右侧详情面板选中深链接指向的节点。**这是恢复后（revision 回到 1）的容器**。

---

## 3. 对第一轮文档错误结论的更正

以下每条都是报告指出、本轮逐条核实的**事实性错误**，已在 §2/本文件中纠正（不新增文件、不虚构内容）：

1. **E2E 通过数**：第一轮写 "e2e 12/12"。第二轮报告在真实浏览器环境复现为 **10 passed / 2 failed**。本轮修完定位器与操作方式后为 **19/19（5 个文件）**，连续三次全新库全绿。
2. **后端用例数**：第一轮写 "api_smoke 88/88"。本轮补充 B04/R05 相关检查后为 **93/93**（`pytest` 入口当时 6 passed，包裹该脚本）。所有者装好 Docker 后又补了 6 个备份/恢复契约用例，现为 **12 passed**。
3. **前端单测数**：第一轮写 37/37。本轮为 **48 passed（6 文件）**（新增冲突保留、markdown、关系等）。
4. **G05 容器 job**：第一轮写"五 job 的本地等价全部绿"。写第二轮报告时的事实是：本机**没有 Docker**（无 CLI、无 docker.sock），**container job 从未在本地或以任何形式跑过** → 当时标 **待远端权限**，不得以其它 job 的绿替代。**该条现已更新**：所有者本轮在本机安装 Docker（29.4.0 + Compose v5.1.2），容器路径已**本机实测通过**（§2.1 D01–D03）；随后首次 push 触发的远端 CI 里 **container job 也跑绿了**（§4），"本地等价物"与"远端真跑"两件事至此都有实证。
5. **G03 Issue 模板数量**：第一轮写"三模板"。仓库实际为 `bug_report.yml` + `feature_request.yml`（外加 `config.yml` 选择器），**没有第三个模板**；本文件不再声称存在，也不为凑数新增。
6. **G09 文件职责**：第一轮写有 `WORKSPACE.md` 与 `PROTOCOL.md`。**这两个文件在仓库中不存在**（`ci.yml` 的文件列表与仓库实际文件都没有）。已删除该声称，不新造文件。
7. **A03 的口径**：第一轮把 1100+ 规模首开 zoom 0.4（卡宽 ≈112px、文字 ≈5px）记为"设计取舍"。报告要求改为"**折叠通过、可读性未通过**"。本轮按 R03 修复后重测 **0.7 / 196px / 9.8px**，故 A03 现为**已修复且验证**（§2 R03）。
8. **MiniMap"空白"**：第一轮记为"大图下的已知限制/待改进"。本轮定位到真因（受控 nodes 未写 measured）并修复、截图佐证。
9. **署名与 `AGENTS.md` 冲突**：存量 **15 个**提交（第一轮 14 个 + `cab94b2` 之前的初版）带 `Co-Authored-By: Claude Code` 尾注，与本仓 `AGENTS.md:94`"AI 工具不得列为作者"冲突。本轮 12 个提交本就没带尾注（只有存量 15 个有问题）。
   **该条已不再是"待决定"**：所有者决定**全部改写**（含已公开的 `1c5677e`），本交付于 2026-09-14 执行 `git filter-branch --msg-filter` 清除全部 15 处尾注，随后 force push 覆盖远端 main（详见 §5-7 与 §9）。改写只动提交消息：
   - 树哈希与改写前**完全相同**（`HEAD^{tree}` 比对通过）；
   - 33 条消息除被删的尾注行外**逐字节一致**（原始 commit 对象逐条比对）；
   - 作者、作者日期、提交日期全部保留；
   - 代价：**全部 33 个提交的 SHA 都变了**，旧 SHA 失效——本文件与 CHANGELOG 里引用的提交号已按映射同步更新（本文件 19 处）。任何基于旧 SHA 的外部引用都需要重新对齐。
10. **远端状态**：写第二轮记录时，本地可核对的唯一远端事实是 `origin/main` 停在 v0.1 初版（当时的 `1c5677e`）——
    该提交**不含 `.github/`**，因此远端**从未执行过任何 workflow**（这也印证 G05 的
    "CI 未运行"不是保守措辞而是实况）。**该条现已全部改判**（2026-09-14，所有者授权后）：
    远端 main 已更新为含 `.github/` 的历史且 **CI 5/5 全绿**（§4）；description / topics /
    Discussions / 合并策略 / secret scanning 已按 §9 实际配置并逐项读回核对；ruleset 仍是 0 条
    （未配置，见 §9 的待办），tag 与 Release 见 §9。

---

## 4. 测试与门禁实测（本轮最终提交、全新数据）

| 关卡 | 命令 | 结果 |
|---|---|---|
| 类型检查 | `cd frontend && npx tsc --noEmit` | **0 错误** |
| 前端单测 | `npm run test`（vitest） | **48 passed / 6 files** |
| 前端构建 | `npm run build` | 成功（仅 chunk 体积告警） |
| 后端 | `backend/.venv/bin/python -m pytest backend/tests -q` | **12 passed**（包裹 `api_smoke` 93/93 + 5 个 CLI 契约用例 + 6 个备份/恢复契约用例 `test_backup.py`） |
| API 冒烟明细 | `RESEARCHMAP_DB=… RESEARCHMAP_TOKENS='{"researcher":"…","ai-sim":"…"}' backend/.venv/bin/python backend/tests/api_smoke.py` | **93/93 passed** |
| E2E（浏览器，生产形） | `cd frontend && E2E_DB_DIR=$(mktemp -d) npx playwright test` | **19 passed**，连跑三次：18.0s / 17.3s / 17.9s |
| 压测读数 | `scripts/measure_firstopen.mjs`（见 §7） | 1104 节点：zoom 0.7 / 卡宽 196px / 标题 9.8px / 8 卡完整入屏 |
| 容器全链路（本机 Docker） | §2.1 的演练序列（build → 鉴权 → 深链接 → 备份 → 恢复 → 重启/重建 → 独立实例） | 全通过；备份 1/3/0/1、恢复后 revision 2→1、独立实例读数一致 |
| 容器真实浏览器 | `scripts/verify_container.mjs`（对 8022/8023 两个实例） | 修订后容器：`cardsOnCanvas=2`、`detailVisible=true`、`consoleErrors=[]` |
| CI（远端，**首次真实运行**） | push 到 `sugarblock233/Ideamify` 后 GitHub Actions 自动触发：[run 34816758423](https://github.com/sugarblock233/Ideamify/actions/runs/34816758423) | **5/5 job 全绿，1m9s**：frontend 17s / backend 21s / container 23s / e2e 1m5s / repository checks 12s；**container job 在 CI 机器上真的构建并跑通了**（这正是本地 Docker 验证不能替代的那一件事）。唯一注解：`actions/checkout@…`、`setup-node@…`、`setup-python@…` 仍声明 node20 运行时，GitHub 强制它们跑在 node24 上并给出弃用警告——不影响结果，见 §6-8 |
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
| 4 | Docker / Windows 11 验证 | **Docker 部分已在本机完成；Windows 11 仍推迟** | 所有者本轮装了 Docker（29.4.0 + Compose v5.1.2），D01/D02/D03 已**本机实测通过**（§2.1），不再是"未验证"；Windows 11 与 podman 明确不做，不阻塞 |
| 5 | push / tag / 发布 / 可见性 | **已落实（push + force push + tag + Release）** | 所有者授权后已 push 到 `sugarblock233/Ideamify`（因历史改写用 `--force-with-lease`）；tag 与 Release 见 §9。可见性**未改动**（仓库公开状态与操作前一致） |
| 6 | 远端仓库设置（topics/description/ruleset/安全特性） | **大部分已落实，ruleset 仍未配置** | 已用 `gh repo edit` 配置并逐项读回核对：description、10 个 topics、Discussions 打开、squash/rebase 开 + merge commit 关 + 合并后删分支、secret scanning 与 push protection 打开。**ruleset 仍为 0 条**（未做，原因见 §9） |
| 7 | 存量 15 个提交的 `Co-Authored-By` 尾注 | **已决定并落实（全部改写）** | 所有者选择连已公开的 `1c5677e` 一起改写；2026-09-14 用 `git filter-branch --msg-filter` 清除 15 处尾注并 force push。33 个 SHA 全部变化，文档引用已同步；验证方式与代价见 §3-9、§9 |

---

## 6. 未验证项与补验步骤（诚实清单）

1. ~~**CI 远端全绿（含 container job）**~~ → **已跑通 5/5**（§4，run 34816758423）。仍值得留意：CI 只跑过一次，"连续 20 次绿"这类稳定性结论**尚未成立**。
2. ~~D01/D02/D03 容器行为~~ → **已在本机 Docker 上验证通过**（§2.1）。剩余补验：CI container job 跑通；以及 Windows 11 / podman（所有者已明确推迟）。
3. **本地 Node 24.10.0 与 CI 基线 22 的差异** — 未消差。补验：CI 首次绿即视为消差。
4. **A07 深链接的 1 次偶发失败** — 未定位（报错文本未留存），此后 43 次连跑未复现。补验：CI 连续 20 次全绿后撤销"残余风险"标记。
5. **B04 其它浏览器分支**（上移/同级排序/环防护/历史翻页）— 本轮只补验了报告点名的"归档→恢复"往返（并因此发现并修复了真实缺陷，见下），其余分支仍只有后端语义覆盖。补验：4 个浏览器用例。
6. **A03 的极小/极大视口**（400px、4K）— 只有 1440×900 与 1280×800 两张读数。补验：各加一张截图。
7. ~~**远端仓库状态类声明**（topics/ruleset/告警）~~ → **已读回核对**（§9.4）：description/topics/Discussions/合并策略/secret scanning 均已配置并有读回值；**ruleset 仍为 0 条**（这是有意留下的待办，不是遗漏）。
8. **CI 里 actions 的 node20 运行时弃用警告** — 5 个 job 都带这条注解：`actions/checkout`、`setup-node`、`setup-python` 被钉住的 SHA 仍声明 node20，GitHub 强制其跑在 node24 上。**当前不影响结果**（全绿）。补验/处理：把这几个 action 升到声明 node24 的新主版本并重新核对 SHA——属于 R10 的顺延项，本轮未做（避免在发布前动 CI 引脚）。

### 本轮计划外发现并修复的缺陷

- **B04 归档后无法在浏览器恢复**（报告只要求"补验"）：后端 `graph` 默认过滤归档节点、搜索同样过滤，而前端**没有任何恢复入口**（`SidePanel` 的 `onRestore` 只连了 props 未渲染）——归档即不可逆。修复：`graph?include_archived=true`、顶栏 ⋯「显示/隐藏已归档节点」开关（跨提交同步保持）、画布归档卡样式 + 「已归档」标记、详情面板「恢复此节点」+ 必填原因。提交 `1721e0d`，e2e `f8a178a`。**反向验证**：仅回退 `SidePanel.tsx` 时用例停在等待「恢复此节点」按钮，证明缺失入口就是缺陷本身。
- **R02 的 syncAll 变体**（见 §2 R02）：未处理的冲突会被后续任意一次成功提交静默清掉。修复 `d98d809`，含单元测试 5 条与一条真实路径 e2e。
- **Dockerfile 的前端产物路径写错**（本轮容器验证发现；报告未涉及）：`COPY --from=frontend-build /src/frontend/dist ./frontend-dist` 指向不存在的路径——`vite.config.ts` 的 `outDir: "dist"` 是相对项目根解析的，而构建阶段 `WORKDIR /src`，所以产物落在 `/src/dist`（`COPY frontend/ ./` 拷贝的是 frontend/ 的**内容**）。镜像此前**从未构建成功过**；第一次真跑 `docker compose build` 就报 `/src/frontend/dist: not found`。修复 Dockerfile 并加构建期断言（`test -f /src/dist/index.html`、运行阶段 `test -f /app/frontend-dist/index.html`），让构建失败而不是首个请求失败。
- **备份链路的静默丢数据陷阱**（本轮容器验证发现；报告未涉及）：库是 WAL 模式，`docker cp researchmap.db` 只能拿到 4 KB、**一个表都没有**的主文件（真实数据在 `researchmap.db-wal`，实测 218392 字节 / 3 节点），而旧版 `tools/backup.py verify` 对这种文件照打 `"缺表"` + `verify 通过。`——**给一份空库背书，比直接失败更危险**。修复：`check_db` 对缺任一 `SCHEMA_TABLES` 直接非零退出，并在错误里点名 `-wal` 侧写文件与 `docker cp` 陷阱；新增 `backend/tests/test_backup.py` 6 条契约用例（缺表必须失败、缺表源不得产出备份、**真实 WAL 源仍要拷出完整数据**、恢复必须有 `--server-stopped`、恢复要留档旧库并清掉残留 `-wal`）。**反向验证**：把守卫摘掉重跑 → 3 条安全用例失败；恢复后 6/6 通过。README 双语补上可复制的容器备份/恢复流程（`docker compose run --rm -v "$PWD/tools:/tools:ro"`，因为 `tools/` 被 `.dockerignore` 排除在镜像外）。

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
| `docs/evidence/d03-container-restored-1440x900.png` | **D03 关键证据**：容器部署经备份→恢复→重建后的真实浏览器画面（顶栏 `项目 v1` = 恢复后的 revision 1，深链接选中的详情面板可读） |

### 复现命令

```bash
# 前端：类型检查 + 单测 + 构建（48 用例）
cd frontend && npm ci && npm run build && npm run test && npx tsc --noEmit

# 后端：pytest 包裹 api_smoke（93/93）+ CLI 契约用例 + 备份/恢复契约用例（共 12 用例）
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

# D01–D03：容器全链路（合成令牌与合成数据；完整序列见 §2.1）
cp .env.example .env   # 或 export RESEARCHMAP_TOKENS='{"container":"container-token-0001"}'
RESEARCHMAP_PORT=8022 docker compose up -d --build
docker port betterairesearch-researchmap-1                     # → 127.0.0.1:8022
docker compose run --rm -v "$PWD/tools:/tools:ro" researchmap \
  python /tools/backup.py backup --db /data/researchmap.db --out /data/backups
RESEARCHMAP_BASE_URL=http://127.0.0.1:8022 RESEARCHMAP_TOKEN=container-token-0001 \
RESEARCHMAP_SHOT=/tmp/rm-d03/container.png node scripts/verify_container.mjs <pid>
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
- **临时资源已清理**：scratch 服务器终止，`/tmp/rm-*` 删除。容器演练起的两个容器（`betterairesearch-researchmap-1`、独立实例 `rm-d03-restored`）已 `docker compose down` / `docker rm -f` 删除，演练专用卷 `rm-d03-restore` 已删；**镜像 `researchmap:0.1` 与 compose 数据卷 `betterairesearch_researchmap-data` 保留**（后者只含本次合成演练数据，属项目声明的卷）——**没有删除任何真实或既有测试卷**。
- **状态小结**：R01–R10 **已修复且验证**（R10 的"远端跑一次"已由首次 push 的 5/5 全绿补齐）；**D01/D02/D03 已修复且验证**（本机容器实测 §2.1 + 远端 container job 双证）；已 push、已打 tag、已发布 Release（§9）。仍未做的只有 **Windows 11 / podman** 与 **CI 稳定性重复验证**（所有者已推迟 / 尚不成立）。

**结论：本地实施完成并已 push；发布仍待这些事项** —— ① 远端 CI 跑绿（含 container job；"本机容器已验证"不能替代它）；② ~~存量 15 个提交尾注是否改写~~ → **已决定并落实（全部改写，§5-7）**；③ 远端仓库设置（topics/description/ruleset/安全特性）与首次 tag/发布；④ Windows 11 / podman 验证（所有者已推迟）。
---

## 9. 发布操作记录（2026-09-14，所有者授权后）

前八节记的是"本地实现与验证"。本节记的是**对外操作**——历史改写、push、远端设置、tag 与
Release。凡是"已配置"的结论都附了**读回核对**的命令与输出，不是"点了就算"。

### 9.1 历史改写：清除 15 处 `Co-Authored-By` 尾注

所有者选择**全部改写**（连已公开的 v0.1 初版一起），依据是本仓 `AGENTS.md:94`
"AI 工具不得列为作者"。

```bash
git rev-list HEAD > /tmp/rm-old-shas.txt          # 改写前快照：33 个提交、HEAD 与 tree
git rev-parse HEAD^{tree} > /tmp/rm-old-tree.txt
FILTER_BRANCH_SQUELCH_WARNING=1 \
  git filter-branch -f --msg-filter 'python3 /tmp/rm_strip_trailer.py' HEAD
```

`msg-filter` 只删形如 `^\s*co-authored-by:.*(claude|anthropic|gpt|copilot|gemini)` 的行，
并清掉它留下的空行；**没有匹配到就原样透传**（所以 18 个本来干净的提交一个字节都不动）。

改写后逐条核对（这三条是本记录"改写是安全的"的全部依据）：

| 检查 | 方法 | 结果 |
|---|---|---|
| 文件内容未变 | 比较改写前后 `HEAD^{tree}` | **哈希完全相同** |
| 消息未被误伤 | 33 条原始 commit 对象的 message 逐条 `diff`（旧消息过一遍过滤器 vs 新消息） | **除被删的尾注行外逐字节一致** |
| 归属信息保留 | `git log -1 --format='%an <%ae> %ad'` 新旧对比 | 作者、作者日期、提交日期**全部一致** |
| 尾注清零 | 遍历全历史 grep `^Co-Authored-By` | **0**（改写前 15） |

**代价（必须写明）**：33 个提交的 SHA **全部变化**。本文件与 `CHANGELOG.md` 里引用的提交号
已按映射同步更新（本文件 19 处，含 §2 表中的 R 项提交号、§3-10、§5-7）。任何**基于旧 SHA 的
外部引用**（截图、Issue、聊天记录、别人 clone 的分支）都需要重新对齐——这是所有者已知并接受的代价。

### 9.2 push（含一次 force push）

远端 `origin/main` 原本只有 v0.1 一个提交，且它本身带尾注、也被改写，所以必须 force push：

```bash
git ls-remote origin refs/heads/main        # 先确认远端仍是已知旧提交
# 1c5677eb24139909787eed9d3169321a9efb9886  refs/heads/main
git push --force-with-lease=main:1c5677eb24139909787eed9d3169321a9efb9886 origin main
#  + 1c5677e...e52f264 main -> main (forced update)
```

用 `--force-with-lease` 而不是 `--force`：如果远端在我读取之后被别人改过，lease 不匹配会
**拒绝推送**，而不是把别人的提交覆盖掉。

push 后读回核对：

- `git ls-remote` → `e52f264…refs/heads/main`；`git rev-list --count origin/main` → **34**
- 遍历远端全部提交 grep 尾注 → **0**
- `git ls-tree -r --name-only origin/main | grep -c acceptance-2026-09-1` → **0**
  （`docs/acceptance-2026-09-1{3,4}/` 始终 untracked，**没有**被推上去）
- 可见性未改：操作前后都是 public

### 9.3 远端 CI 首次真实运行

push 直接触发了 `.github/workflows/ci.yml` 的第一次远端执行：

| job | 结果 | 耗时 |
|---|---|---|
| frontend（typecheck / vitest / build） | ✓ | 17s |
| backend（干净 venv + 锁文件 + pytest） | ✓ | 21s |
| e2e（Playwright，生产形同源） | ✓ | 1m5s |
| container（构建 + 启动 + 鉴权 + SPA 回退） | ✓ | 23s |
| repository checks（路径/凭证、链接、JSON/YAML） | ✓ | 12s |

**5/5 全绿，总 1m9s**：https://github.com/sugarblock233/Ideamify/actions/runs/34816758423

这条把 §6-1、§3-4 里两个"待远端权限"一次结清：container job 在 **CI 机器上**真的构建并跑通了，
这正是"本机容器已验证"**不能**替代的那一件事。

唯一注解：`actions/checkout` / `setup-node` / `setup-python` 被钉住的 SHA 仍声明 node20 运行时，
GitHub 强制它们跑在 node24 上并给出弃用警告。**不影响结果**，但记在 §6-8 作为残留项。

### 9.4 远端仓库设置（逐项读回）

```bash
gh repo edit sugarblock233/Ideamify \
  --description "Self-hosted research-evolution map co-maintained by one researcher and their trusted AI tools — routes, trials, negative results, findings and decisions." \
  --add-topic research,knowledge-graph,research-tool,react,fastapi,sqlite,playwright,self-hosted,ai-collaboration,ideamify \
  --enable-discussions \
  --enable-squash-merge --enable-rebase-merge --enable-merge-commit=false \
  --delete-branch-on-merge \
  --enable-secret-scanning --enable-secret-scanning-push-protection
gh api repos/sugarblock233/Ideamify        # 读回核对
```

| 项 | 改前 | 改后（读回值） |
|---|---|---|
| description | 一句带连字符的旧文案 | 与 README 定位一致的实测值（见上） |
| topics | **空** | 10 个：`ai-collaboration` `fastapi` `ideamify` `knowledge-graph` `playwright` `react` `research` `research-tool` `self-hosted` `sqlite` |
| Discussions | 关闭 | **打开**（`SECURITY.md` 把 Issues/Discussions 写成唯一联系渠道，必须真的存在） |
| 合并策略 | 未设置 | squash ✓ / rebase ✓ / merge commit ✗ / 合并后删分支 ✓ |
| secret scanning | 未启用 | **enabled**；push protection 也 **enabled** |
| 可见性 | public | public（**未改动**） |

**ruleset 仍是 0 条**（`gh api repos/.../rulesets` → `[]`）。没有默认替所有者建，原因写在下面：
刚做完一次 force push，而 ruleset 若禁用 force push 会立刻锁掉这条路。建不建、建多严（只防删除、
还是强制 PR），属于会影响所有者自己工作流的决定，列为待办而不是擅自加。

### 9.5 tag 与 Release

见本文件末尾的「发布状态」小节（写入时以 `git tag` / `gh release view` 的读回值为准）。
