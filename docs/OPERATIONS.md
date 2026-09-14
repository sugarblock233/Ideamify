# Running and protecting your instance

[简体中文](OPERATIONS.zh-CN.md) · [Documentation](README.md)

Run the commands below from the checkout used to start your instance, with
its `.env` file in place. Keep using the same Compose project name: Compose
prefixes the `researchmap-data` volume with it. A different project name can
start an empty instance using a different volume.

## Check, stop and restart

```bash
docker compose ps
curl --fail http://127.0.0.1:8000/healthz
docker compose logs --tail 50 researchmap
```

Adjust the URL if you changed `RESEARCHMAP_PORT`. If the page cannot load,
check the container status and whether another service already uses the port.
For a rejected token, check the configured value and restart after correcting
configuration as described below.

```bash
docker compose stop researchmap
docker compose start researchmap
```

Saved records remain in the volume. `docker compose down` also preserves it;
**`docker compose down --volumes` deletes it**. Browser drafts must be saved
before stopping. The default port is bound only to `127.0.0.1`; use a trusted
network or protected proxy if access from another computer is needed.

To change or revoke a token, edit `.env` and run `docker compose up -d` so
Compose recreates the service with the new environment. A plain `restart`
does not load changed environment variables. Token names in old commits remain
part of history. Keep `.env` separately from database backups, in private storage.

## Back up the running database

SQLite uses WAL mode. Use the online backup tool; copying only the live `.db`
file can miss data still in its WAL file. This procedure needs only Docker:

```bash
mkdir -p backups
docker compose run --rm -T -v "$PWD/tools:/tools:ro" researchmap \
  python /tools/backup.py backup --db /data/researchmap.db --out /data/backups
docker compose cp researchmap:/data/backups/. ./backups/
```

The tool prints the generated filenames and verifies the database copy. It
creates a self-contained `.db` backup and a `.sql` snapshot. The `backups/`
folder is ignored by Git. Copy it to separate storage; a copy in the same
Docker volume does not protect against losing that volume or disk.

Set `BACKUP_FILE` to the **actual `.db` filename printed by the command**:

```bash
BACKUP_FILE=researchmap-YYYYMMDDTHHMMSSZ.db
docker compose run --rm -T \
  -v "$PWD/tools:/tools:ro" -v "$PWD/backups:/backups:ro" researchmap \
  python /tools/backup.py verify "/backups/$BACKUP_FILE"
```

The filename above is a placeholder. Check that verification succeeds and
prints the expected project, node and commit counts. Evidence URLs and paths
are references; referenced papers, datasets and other files need separate backups.

## Restore a backup

Restoring replaces the current database with the chosen snapshot. Stop all
writers first, including any other container using the same data volume.
Use the verified `BACKUP_FILE` from the previous step:

```bash
docker compose stop researchmap
docker compose run --rm -T \
  -v "$PWD/tools:/tools:ro" -v "$PWD/backups:/backups:ro" researchmap \
  python /tools/backup.py restore --src "/backups/$BACKUP_FILE" \
    --dst /data/researchmap.db --server-stopped --yes
docker compose start researchmap
```

The restore tool keeps the previous database as a `.pre-restore-*` file and
removes obsolete WAL sidecars. Log in again, inspect your project and revision,
and open a known node and its history. Verification checks database integrity;
this final read confirms you restored the intended research snapshot.

The menu's JSON export is useful for inspection and AI handoff. It includes
archived records and history, but v0.1 has no corresponding JSON import command.
Use the `.db` backup for recovery.

## Upgrade deliberately

Read the [changelog](../CHANGELOG.md), save browser edits, and make a verified
backup first. Record the version you are running with `git rev-parse HEAD`.
For an unmodified checkout on `main`:

```bash
git status --short
git pull --ff-only
docker compose up -d --build
```

Keep local code changes separate before pulling. If you checked out a release
tag, explicitly select the next version instead of using the `main` command.
After upgrading, check `/healthz`, log in and open a saved node and its history.
If a release changes the schema, follow its migration notes. Rolling back the
code alone may be insufficient; retain the matching database backup too.
