# Security

## Trust model

ResearchMap is designed around one trust boundary: **one researcher and a
small circle of tools they have explicitly handed out a token to.**

- **Bearer tokens are root for the instance.** The application is
  single-researcher by design: there is no multi-tenancy, no per-project
  role system, and no API that an authenticated principal may not touch.
  Anyone holding a token can read and write every project, export data, and
  see the full commit history.
- **The token name is the actor identity.** Commit records attribute changes
  to the *name* of the token used; the identity comes from authentication and
  cannot be claimed in the request body (a `client_label` is self-attested and
  never authoritative for authorization).
- **Tokens live only in runtime configuration.** They are read from the
  `RESEARCHMAP_TOKENS` environment variable (inline JSON or a protected file
  path) at startup. Only SHA-256 hashes are held at runtime. Tokens are never
  stored in the image, in Git, in backups, in exports, or in logs.
- **Loopback by default.** `compose.yaml` publishes the container port on
  `127.0.0.1` only. A remote, multi-client deployment is the operator's
  choice (private network or HTTPS reverse proxy) and is outside this
  project's scope.

Implication: lose a token → rotate it in `.env` and restart the container.
The retired token's identity remains visible in historical commit records.

## Supported versions

This project is in the **0.x pre-release stage** and there are no stability
guarantees: APIs, CLI behavior, and the database format may change without
compatibility promises between patches (0.x in particular).

Support scope: until the first tag exists, only the latest commit on `main`;
after tagging, only the latest published tag is maintained.
No backports, and no support for keeping a 0.x build "as-is" in a production
deployment. If you store research data here, plan deliberate upgrades and keep
verified backups stored onto a separate host.

## Reporting a vulnerability

1. **Check whether private vulnerability reporting is enabled** in the
   repository settings (the "Report a vulnerability" option in the issue menu).
   If it is enabled, **use it — that is the preferred channel.**
2. If it is not enabled, notify the maintainer off-channel first (e.g. via
   their GitHub profile), then optionally open an issue marked as sensitive
   once the maintainer confirms. No email address is intentionally listed in
   this file; do not guess or fabricate one.
3. **Do not** post exploit details, working PoC data, or real tokens in a
   public issue before a fix is available.

**No SLA.** Reports are handled on a best-effort basis by a single
maintainer. There is no committed response time and no coordinated-disclosure
timeline.

## Minimum information for a report

- Version or commit SHA (`git rev-parse --short HEAD`) of the running build.
- Exact reproduction steps against a fresh instance.
- A sanitized log or response body — with **token values and any real
  research content removed** before you send it.

## Out of scope

Issues that do not cross a security boundary (e.g. content rendering bugs,
perceived UX gaps) belong in a regular GitHub issue instead — use the bug
template.