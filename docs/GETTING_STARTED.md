# Build your first research route map

[简体中文](GETTING_STARTED.zh-CN.md) · [Documentation](README.md)

Start the app using the [README](../README.md). The interface labels below
match the current Chinese UI. This walkthrough uses a **synthetic example**;
replace its content with your own question when you start a real project.
The [research authoring guide](RESEARCH_AUTHORING.md) explains the content method in full. All operations on this page use current features.

## 1. Create a project around a question

Local mode opens the project manager without login. On a fresh instance, fill in the project name
and research objective, then choose **创建项目**. For example:

- Name: “Literature retrieval strategies”
- Objective: “Can keyword expansion improve evidence coverage without adding noise?”

A project is the long-lived record of that question. You do not need a new
project for each experiment or AI session.

## 2. Establish routes, then divide them into questions

Separate routes by research question: for example, improve query expression,
improve result selection, and examine the evaluation set. Choose **+ 一级路线**,
use **问题** or **想法**, and explain the purpose and basis in the title, summary
and rationale. You do not need to cover every possible direction at once.

Under query expression, use **+ 子节点** for “Which misses come from terminology
differences?”, then an idea such as “Can controlled synonym expansion recover
evidence?” Add “Compare original queries with controlled expansion on a fixed
set” as an attempt when there is a comparison design or actual exploration.
The card's right-click menu also creates children.

Explain why each step follows from earlier work. Continue deeper when useful,
without forcing equal depth across routes. Put scripts, configurations and
repeated runs in the relevant node's body and evidence. Code without execution
evidence means “implemented, execution unconfirmed, effectiveness unknown”; do
not fill in nonexistent results.

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

## 3. Write straight onto the map: the draft card

Choose **+ 一级路线** or a card's **+ 子节点** (also in the right-click menu)
and no dialog opens: a dashed **draft card** appears beside its parent right
on the map, while the side panel simultaneously shows the same form — the
two editors share one draft, so you can type in either. Nothing is committed
until you save.

Pressing Enter inside the draft card's title only confirms the input (Enter
during Chinese IME composition never submits); ⌘/Ctrl+Enter or the **创建**
button saves, and **取消** makes the card vanish with no record left behind.
Once saved, the draft card gives way to the real card, located for you.

Switching between 横向树 / 纵向树 / 大纲 keeps the draft: in outline mode it
degrades to a read-only dashed row while editing stays in the side panel. A
failed save (offline or a revision conflict) keeps the draft as it was, with
the error shown in the panel — retry straight away. No matter how many times
one draft is retried, it produces exactly one commit and one new card.

## 4. Tables and images in node details

The details body is Markdown. **插入表格** in the editor toolbar inserts an
editable row/column table template; wide tables scroll horizontally inside
the container in the read view instead of breaking the card.

**插入图片** picks a local image, or paste a screenshot straight into the
body textarea — images upload as managed attachments, referenced in the
markdown as `![name](attachment:…)`. They render inline in the read and
preview views and can be clicked to zoom. Images are served only through an
authenticated endpoint (the token never appears in an image URL); external
`https://` images are never loaded and degrade to a placeholder showing the
URL text. Cancelling a draft after uploading leaves no referenced record;
unreferenced uploads are cleaned up after 30 days, while saved references
never get deleted.

## 5. Preserve negative results and explain the next step

Keep the original negative result. Explain the question it raises, such as
“When should expansion be triggered?”, before proposing “Expand keywords only
for low-recall questions.” The new question may belong under the attempt or a
more suitable broader question. Explain the transition in rationale and, when
appropriate, add a motivates relation from the old result to the new question.

Different attempts can have different conditions and outcomes; do not turn the
original result green because a later variation worked. If a finding changes
the route's judgment, update its summary and decision so someone reading only
the top level understands it. Child statuses do not propagate to the route.

The **关联** tab links work across branches. The **历史** tab shows the selected
node's commits and before/after changes. Search finds earlier work by title,
summary, tags, finding or decision. A card's right-click menu can copy a node link.

## 6. Views and layouts

Above the map sits a row of view tools (these settings live only in this
browser; they are never part of the research record):

- **Bulk expand/collapse**: expand all, collapse all, expand to level 1–3,
  expand the selected subtree; after a batch action, **恢复上次** steps back.
- **Layout**: switch 横向树 / 纵向树 / 大纲 from the ⋯ menu. Each layout
  remembers its own folds, branch filter and viewport; a new layout opens
  with the first two levels expanded.
- **Density**: cards start at the reading tier and step down automatically
  as you zoom out — compact (summary and counts hidden), then overview
  (color blocks with a route-name overlay, a legend and a zoom-to-locate
  chip). You can also lock a tier. **低干扰** hides tags and counts.
- **Detail panel**: drag its left edge to resize; when collapsed a restore
  button stays on the right edge, marked with a dot when a draft is dirty.
- **Language**: 中文 / English from the top-bar ⋯ menu; content and API
  fields are never translated.

For deeper reading in the current app, focus one branch, use the horizontal
tree or outline, and progressively expand and open details. The 1–3 level
shortcuts do not limit the data to three levels. Avoid repeatedly fitting a
large graph to read its text. The proposed research overview and route reader
are still [design work](RESEARCH_MAP_REDESIGN.zh-CN.md).

## 7. Versions and swimlanes

When the work reaches a second or third round, tag the plan with
**research versions** (v1, v2, v3 …). These are phase labels, not save
records — the **记录 #N** on screen counts saves, while v1/v2 mark research
stages; the two never mix.

- **Tag nodes**: open a node's details → 编辑, light up chips in the
  科研版本 section (a node may belong to several versions) and save. New
  drafts pre-fill the version you are currently filtering by.
- **Browse by version**: ⋯ menu → filter by research version (including
  未分配) to see just that round; matched nodes keep their route ancestors
  visible as context, and a selected node that got filtered out shows a
  hint with a one-click restore in the detail panel. The filter survives
  layout switches and reloads; pick 全部版本 to go back.
- **Swimlane view**: choose **泳道** in the layout menu for a
  version × route progress grid — columns are versions plus 未分配, rows
  are top-level routes; tree edges hide and folds/branch filters don't
  apply. Good for seeing which routes each round covers at a glance.

## 8. Hand the record to your AI

Use **⋯ → AI 接入说明** to get the server address, project ID and command examples.
In token mode, configure a named token in the AI's terminal environment.
Local mode can omit it, or use a named token for attribution. Give the AI this
instruction, filling in the project ID and actual next task:

> Read docs/RESEARCH_AUTHORING.md and docs/AI_USAGE.md. Continue PROJECT_ID
> using the configured connection. Read the objective, routes and focus, then
> use node for motivation, judgments and evidence, including negative results.
> Explain the main routes before focusing on this subquestion; do not build a
> catalogue of scripts and run IDs.
> For the agreed task, write understandable titles and summaries explaining
> research meaning, motivation and next steps. Distinguish proposals, code,
> execution and evidence-backed results; missing evidence remains unknown.
> This task does not automatically authorize experiments.
> Preserve IDs, findings and human notes. Add justified relations and update
> affected route summaries when needed. Dry-run, commit and read back; re-read
> and merge on conflicts. Hand off new understanding, its effect on the route
> and the next question. Never print or record the token.

The app supplies a record, not an AI connection. Your external tool needs to
be able to run the [CLI](../tools/researchmap.py) with Python 3 and reach the
same server. `localhost` on another computer is that other computer, not
this instance; arrange a trusted connection before using a remote AI tool.

## 9. Review the update and finish the session

Use the app's **刷新** or **载入更新** button. Review the new node and history;
the AI token's name should appear as the actor. Concurrent edits to the same
field require your choice before saving; unrelated edits can be merged.

Save your edits before closing. The browser warns on ordinary reload or
navigation while a node draft is dirty, but this is not crash recovery or
autosave. Local mode reloads without login. Token mode requires the token again. The project stays on the server.

When a leaf node is no longer useful, archive it instead of deleting history.
Use **⋯ → 显示已归档节点** to find it and restore it. Before upgrades, follow
[the backup guide](OPERATIONS.md).
