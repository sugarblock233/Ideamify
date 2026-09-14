# Ideamify

[简体中文](README.zh-CN.md) · [Getting started](docs/GETTING_STARTED.md) · [AI guide](docs/AI_USAGE.md) · [Discussions](https://github.com/sugarblock233/Ideamify/discussions)

[![CI](https://github.com/sugarblock233/Ideamify/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/sugarblock233/Ideamify/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

Keep a map of how your research develops: the questions you asked, the routes
you tried, what happened, and why you chose the next step. Your AI tools can
read and update the same record, so a new session can pick up where you left off.

![Research map with two routes and linked findings. All data is synthetic.](docs/images/workspace-1440x900.png)

## What you can do

- Organize questions, ideas, attempts and findings in a research tree.
- Record observations, evidence and decisions, including negative results
  and the conditions under which a conclusion holds.
- Connect related work across branches and inspect who changed what.
- Let external AI tools use the HTTP API or Python CLI, with revision checks
  that prevent one session from silently overwriting another.
- Run locally with Docker and keep your records in a persistent SQLite volume.
- Views and layouts (new): horizontal tree / vertical tree / outline list,
  with folds and viewport remembered per layout; one-click expand/collapse
  tools; zoom-driven density tiers (reading / compact / overview) and a
  low-interference mode; a resizable, collapsible detail panel; interface
  in Chinese or English.

The app displays the name **ResearchMap**.
Ideamify is the repository name; the CLI and `RESEARCHMAP_*` configuration
use the existing ResearchMap name. The app does not call a model or run
experiments for you. It is designed for one researcher and their trusted tools.

## Run it locally

You need Git and Docker with Compose. Run these commands in a terminal:

```bash
git clone https://github.com/sugarblock233/Ideamify.git
cd Ideamify
cp .env.example .env
```

Edit `.env`: replace both token placeholders with different, long random
values. Run `openssl rand -hex 24` twice to generate them. Keep the names
`researcher` and `ai-one`, or choose your own; these names appear in history.
Every token can read and write all projects in this instance.

```bash
docker compose up -d --build
```

Open **http://127.0.0.1:8000/**, enter your researcher token, and create a
project. Choose **+ 一级路线** to add a route, then select a node and choose
**+ 子节点** to record an attempt or follow-up.

Follow [your first research cycle](docs/GETTING_STARTED.md) for a complete
walkthrough, including handing the record to an AI session.

## Keep using it

- **Save before leaving.** Node edits are saved explicitly. Reloading the page
  asks you to log in again; the token is kept only in page memory.
- **After an AI update**, use the in-app **刷新** button or **载入更新** to bring
  in new records. Review any conflicting fields before saving your draft.
- **Back up your data.** Restarting or rebuilding preserves the Compose
  volume. Follow [backup, restore and upgrades](docs/OPERATIONS.md) to protect
  it. Evidence links reference external files; those files need their own backup.

v0.1 is ready for personal use and feedback. The published `v0.1.0` tag is an
early release; `main` also includes subsequent fixes listed in the
[changelog](CHANGELOG.md). Future work will be driven by actual use.

## Project resources

- [Documentation](docs/README.md): user guides, AI protocol and technical design
- [Contributing](CONTRIBUTING.md): development setup, checks and pull requests
- [Report a bug](https://github.com/sugarblock233/Ideamify/issues/new?template=bug_report.yml) or [ask a question](https://github.com/sugarblock233/Ideamify/discussions) in English or Chinese
- [Security](SECURITY.md) · [Code of conduct](CODE_OF_CONDUCT.md) · [MIT license](LICENSE)
