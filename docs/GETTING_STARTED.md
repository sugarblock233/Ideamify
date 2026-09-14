# Your first research cycle

[简体中文](GETTING_STARTED.zh-CN.md) · [Documentation](README.md)

Start the app using the [README](../README.md). The interface labels below
match the current Chinese UI. This walkthrough uses a **synthetic example**;
replace its content with your own question when you start a real project.

## 1. Create a project around a question

Enter your researcher token. On a fresh instance, fill in the project name
and research objective, then choose **创建项目**. For example:

- Name: “Literature retrieval strategies”
- Objective: “Can keyword expansion improve evidence coverage without adding noise?”

A project is the long-lived record of that question. You do not need a new
project for each experiment or AI session.

## 2. Add a route and an attempt

Choose **+ 一级路线**, use the type **问题** or **想法**, and write a short
summary of the direction you want to explore. Select the saved node and use
**+ 子节点** to add an **尝试**. This is also available from the card's right-click menu.

Use **进行中** for work in progress. After the attempt, choose **编辑** and
record the result. Keep these separate:

| Field | What to record | Synthetic example |
| --- | --- | --- |
| scope / 适用条件 | What you actually tested | Same corpus, 20 fixed questions, Top-10 retrieval |
| finding / 直接观察 | Observations or measured results | Coverage stayed at 60%; irrelevant hits increased |
| decision / 当前解释与决定 | What the result means for the next step | Try expansion only for low-recall questions |
| evidence / 证据 | An inline note, URL or file reference | Evaluation counts or the path to the result table |

Both **当前条件下支持** and **当前条件下不支持** require scope, finding,
decision and at least one evidence item. Use **尚不能判断** when the evidence
does not support a conclusion. The app records your assessment; it does not
verify that the underlying experiment happened or that a URL remains accessible.

Choose **保存**. Use **收起编辑** to return to reading; it does not save edits.
File evidence is a reference, not an upload: keep the referenced file yourself.

## 3. Continue without erasing what you learned

Keep the original negative result. Create a child node for the revised idea:
“Expand keywords only for low-recall questions.” Different attempts can have
different conditions and outcomes; do not turn the original result green
merely because a later variation worked.

The **关联** tab links work across branches. The **历史** tab shows the selected
node's commits and before/after changes. Search finds earlier work by title,
summary, tags, finding or decision. A card's right-click menu can copy a node link.

## 4. Hand the record to your AI

Use **⋯ → AI 接入说明** to get the server address, project ID and command examples.
Configure the AI's separate token in its terminal environment, then give it
this instruction (fill in your project ID and the actual next task):

> Read docs/AI_USAGE.md in this checkout. Work on project PROJECT_ID using
> the configured RESEARCHMAP_BASE_URL and RESEARCHMAP_TOKEN. Read its context,
> then the relevant full nodes and evidence, including negative results.
> First summarize where the research stands. For the agreed next task, write
> only what actually changed, dry-run the commit, commit it, and read it back.
> Keep prior findings and distinguish proposals from completed experiments.
> If the revision changed, read the new content and resolve the conflict.
> Never print the token or put it in the research record.

The app supplies a record, not an AI connection. Your external tool needs to
be able to run the [CLI](../tools/researchmap.py) with Python 3 and reach the
same server. `localhost` on another computer is that other computer, not
this instance; arrange a trusted connection before using a remote AI tool.

## 5. Review the update and finish the session

Use the app's **刷新** or **载入更新** button. Review the new node and history;
the AI token's name should appear as the actor. Concurrent edits to the same
field require your choice before saving; unrelated edits can be merged.

Save your edits before closing. The browser warns on ordinary reload or
navigation while a node draft is dirty, but this is not crash recovery or
autosave. Reloading requires the token again. The project stays on the server.

When a leaf node is no longer useful, archive it instead of deleting history.
Use **⋯ → 显示已归档节点** to find it and restore it. Before upgrades, follow
[the backup guide](OPERATIONS.md).
