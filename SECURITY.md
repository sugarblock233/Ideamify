# Security

## Access model

Ideamify is for one researcher and their trusted tools. Every valid bearer
token can read and write every project, export records and inspect history.
There are no per-project permissions. The token's configured name is recorded
as the actor; a client-supplied label is only descriptive.

Compose binds to `127.0.0.1` by default. Keep the instance on a trusted network
or behind a protected proxy if you need remote access. Keep credentials out
of Git, screenshots and shared logs. Database backups do not include token
configuration; evidence files referenced by the database are separate too.

To revoke a token, change `.env` and run `docker compose up -d` to apply the
new environment. See the [operations guide](docs/OPERATIONS.md).

## Supported versions

Security fixes target the current `main` branch and will be included in the
next release. This is an early 0.x project maintained on a best-effort basis;
there is no guaranteed response time or backport schedule. Before upgrading,
read the changelog and keep a verified backup.

## Report a vulnerability

Use [private vulnerability reporting](https://github.com/sugarblock233/Ideamify/security/advisories/new)
if GitHub makes it available. Otherwise, request a private contact channel
from @sugarblock233 in [Discussions](https://github.com/sugarblock233/Ideamify/discussions),
without publishing the vulnerability details. Issues and Discussions are public.

Once a private channel is established, include the affected version, steps to
reproduce on a fresh instance, and sanitized logs. Do not include real tokens
or private research data in a report. Ordinary usability bugs belong in the
[bug tracker](https://github.com/sugarblock233/Ideamify/issues).
