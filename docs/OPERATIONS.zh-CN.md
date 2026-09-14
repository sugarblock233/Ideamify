# 日常维护：备份、恢复与升级

[English](OPERATIONS.md) · [文档目录](README.md)

以下命令都在启动实例时使用的仓库目录运行，保留对应的 `.env`。继续使用同一个 Compose 项目名：实际的 `researchmap-data` 卷名带有项目名前缀。更换项目名可能创建另一个空卷，看起来像“数据不见了”。

## 检查、停止和启动

```bash
docker compose ps
curl --fail http://127.0.0.1:8000/healthz
docker compose logs --tail 50 researchmap
```

修改过 `RESEARCHMAP_PORT` 就相应修改网址。页面打不开时，先检查容器状态和端口是否被其他服务占用。令牌被拒绝时核对配置值，修正配置后的操作见下文。

```bash
docker compose stop researchmap
docker compose start researchmap
```

已保存的记录保留在卷中。`docker compose down` 也会保留卷，但 **`docker compose down --volumes` 会删除数据卷**。停止服务前先保存浏览器草稿。默认仅绑定 `127.0.0.1`；如需其他机器访问，请通过受信任网络或受保护的代理连接。

更换或撤销令牌时，编辑 `.env` 后执行 `docker compose up -d`，让 Compose 用新环境重新创建服务。仅执行 `restart` 不会载入修改后的环境变量。历史中的旧令牌名称仍然保留。把 `.env` 单独保存在私密位置，它不属于数据库备份。

## 在线备份

SQLite 使用 WAL 模式，直接复制运行中的 `.db` 主文件可能遗漏仍在 WAL 中的数据。使用在线备份工具，下面的流程只依赖 Docker：

```bash
mkdir -p backups
docker compose run --rm -T -v "$PWD/tools:/tools:ro" researchmap \
  python /tools/backup.py backup --db /data/researchmap.db --out /data/backups
docker compose cp researchmap:/data/backups/. ./backups/
```

工具会打印生成的文件名并校验副本，产物包括可独立使用的 `.db` 和 `.sql` 文本快照。`backups/` 不进入 Git。再把副本复制到另一处存储；只留在原 Docker 卷或原磁盘中，不能防范它们丢失。

把 `BACKUP_FILE` 换成刚才输出的**实际 `.db` 文件名**，验证已经复制出来的副本：

```bash
BACKUP_FILE=researchmap-YYYYMMDDTHHMMSSZ.db
docker compose run --rm -T \
  -v "$PWD/tools:/tools:ro" -v "$PWD/backups:/backups:ro" researchmap \
  python /tools/backup.py verify "/backups/$BACKUP_FILE"
```

上面的文件名是占位示例。确认校验通过，项目、节点、提交数量符合预期。证据中的 URL 和路径只是引用，原始论文、数据集和其他文件仍需单独备份。

## 从备份恢复

恢复会用选定快照替换当前数据库。先停止所有写入者，包括任何共用数据卷的其他容器。沿用上一步已验证的 `BACKUP_FILE`：

```bash
docker compose stop researchmap
docker compose run --rm -T \
  -v "$PWD/tools:/tools:ro" -v "$PWD/backups:/backups:ro" researchmap \
  python /tools/backup.py restore --src "/backups/$BACKUP_FILE" \
    --dst /data/researchmap.db --server-stopped --yes
docker compose start researchmap
```

恢复工具会把被替换的库保留为 `.pre-restore-*` 文件，并清理过时的 WAL 文件。启动后重新登录，核对项目与版本号，再打开一条已知节点及其历史。数据库校验保证结构完整，最后这一步确认恢复的是你想要的研究快照。

菜单里的 JSON 导出适合查阅和交接 AI，包含归档记录与历史，但 v0.1 没有对应的 JSON 导入命令。需要恢复实例时使用 `.db` 备份。

## 升级

先读[更新日志](../CHANGELOG.md)、保存浏览器编辑并做一次经校验的备份。用 `git rev-parse HEAD` 记下当前版本。对于没有自行修改代码、使用 `main` 的仓库：

```bash
git status --short
git pull --ff-only
docker compose up -d --build
```

如有本地代码修改，先妥善保存。如果检出的是发布标签，明确选择要升级到的版本，不直接套用 `main` 的命令。升级后检查 `/healthz`，重新登录并打开已保存节点和历史。涉及数据库结构变化时遵循该版本的迁移说明；回退代码不一定足够，也要保留与旧版本对应的数据库备份。
