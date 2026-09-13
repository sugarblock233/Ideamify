# ResearchMap

**科研演化地图（v0.1）**：一个部署在你自己服务器上的轻量 Web 应用，让一位研究者和他信任的若干 AI 工具**共同维护同一份研究地图**——从问题分出路线，记录尝试、观察、成功、失败与决定；过去的探索（尤其负结果和它成立的条件）在换 AI、换设备之后依然可继承。

> 核心设计：数据允许跨分支关联；排版只依据主树；跨分支连线按需显示。折叠绝不丢数据。

## 能做什么（v0.1）

- 浏览器中的项目地图（主树自动布局），节点编辑、折叠、深链定位
- 四类数据：Project / Node / Relation / Commit（变更历史天然成为审计日志）
- 五种跨分支关系（相关 / 启发 / 支持 / 矛盾 / 推导自），默认不画线，选中节点才显示
- 红色状态（当前条件下不支持）强制填写范围、发现、决定与至少一条证据
- AI 读取上下文（含近邻与祖先链）与**幂等批量增量提交**（请求指纹 + 版本冲突 409 + 同一 `request_id` 重试语义）
- 导出（JSON）、命令行备份/校验/恢复（SQLite 在线备份）
- 单容器 + 一个持久卷；令牌身份制（每个令牌 = 一个提交者身份，AI 不可冒充人）

**明确不做**：自动科研执行、训练/GPU 管理、内置模型调用、向量/图数据库、多人实时协作、自由白板、权限体系。没有模型 API Key 也能跑全部核心功能。规格边界见 [`docs/SPEC.md`](docs/SPEC.md)。

## 快速开始

```bash
git clone https://github.com/sugarblock233/Ideamify.git
cd Ideamify
cp .env.example .env        # 改 RESEARCHMAP_TOKENS 里的两个令牌（各 ≥12 字符）
docker compose up -d --build
# 打开 http://localhost:8000/ ，登录界面输入令牌
```

数据只落在卷 `researchmap-data`（SQLite 单文件 `/data/researchmap.db`）。备份：

```bash
python tools/backup.py backup --db <db文件> --out ./backup/ --json   # 在线备份 + SQL + JSON 快照
python tools/backup.py verify --db ./backup/researchmap-<ts>.db
python tools/backup.py restore --src <备份文件> --dst <目标> --server-stopped --yes
```

## 本地开发

```bash
# 后端（FastAPI + SQLite）
cd backend && python -m venv .venv && .venv/bin/pip install -r requirements.txt
RESEARCHMAP_TOKENS='{"researcher":"your-token-0001"}' RESEARCHMAP_DB=/tmp/rm-dev.db \
  .venv/bin/python -m uvicorn app.main:app --port 8000

# 前端（React + Vite + @xyflow/react）
cd frontend && npm ci && npm run dev     # http://localhost:5173，/api 代理到 8000
```

## 目录结构

```
backend/            FastAPI 应用（app/）+ 冒烟测试（tests/）
frontend/           React + TS 前端（src/lib 布局与共享逻辑，src/workspace 画布）
tools/              researchmap.py —— AI/人用的读写 CLI；backup.py —— 备份/恢复
scripts/            stress_test.py —— 1100+ 节点 / 3000 关联压测（自愈，自带 scratch 服务）
examples/           四类 commit 的 JSON 模板（骨架 / 红色尝试 / 续写 / 幕间调整）
docs/               SPEC（规格）、DECISIONS（实现决策）、AI_USAGE（AI 接入协议）
```

## AI 怎么读写这份地图

完整协议见 [`docs/AI_USAGE.md`](docs/AI_USAGE.md)，可直接复制的 commit 模板在 [`examples/`](examples/)。

1. `GET /api/v1/projects/{pid}/context` —— 一段文字世界状态（概览 + 近邻 + 祖先链，支持聚焦）
2. 在应用之外做自己的事（调研 / 写码 / 实验）
3. `POST /api/v1/projects/{pid}/commits` —— 小批量增量提交，必须带 `request_id`（UUID）与
   `expected_revision`。**冲突 409 意味着本次提交未被记录**：刷新版本后可沿用原 `request_id` 重发，
   内容相同则幂等重放（`already_committed: true`）。
4. `tools/researchmap.py` 封装了上述流程（`context / search / commit / projects …`，`--auto-rev` 自动取版本）

端到端实录（真实命令 + 真实输出，含 422 证据门、幂等重放、409 竞争重试）：[`docs/ai-session-example.md`](docs/ai-session-example.md)。

## 测试与验收

| 套件 | 结果 |
| --- | --- |
| 后端冒烟 `backend/tests/api_smoke.py`（鉴权、提交管线、幂等、409、证据门、归档、导出、并发写者…） | 61/61 通过 |
| 前端单测 `frontend/`（布局、折叠、关联端点、压测图 1104 节点不重叠） | 32/32 通过 |
| 浏览器 E2E `frontend/e2e/smoke.spec.ts`（Playwright，生产形同源部署） | 4/4 通过 |
| 压测 `scripts/stress_test.py`（4104 操作 / 87 提交，p50 26ms） | 通过，结构断言全过 |
| 备份 / 恢复演练 | 通过（在线备份 vs 裸拷 WAL 库的安全性对比见 DECISIONS §11） |
| `docker compose build` | 文件就绪；请在有 Docker 的机器上执行 |

实现过程中的小决策统一记录在 [`docs/DECISIONS.md`](docs/DECISIONS.md)。

## 安全模型（单研究者信任域）

- 认证 = Bearer 令牌。仓库内联 JSON `{"名字": "令牌"}`；令牌一经配置，**名字即提交记录里的 actor 身份**，无法伪造
- 不做多租户；任何持有令牌的会话可读写全部项目——请把令牌视为根凭据
- `.env` 不入库（`.gitignore`）；令牌只在运行时配置，镜像里不存在

## License

待定（请在 `LICENSE` 中补充后发布）。