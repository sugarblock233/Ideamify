# Writing a research map: routes first, then deeper questions

[简体中文](RESEARCH_AUTHORING.zh-CN.md) · [AI protocol](AI_USAGE.md) · [Getting started](GETTING_STARTED.md) · [Documentation](README.md)

This guide works with the current nodes, fields and CLI. It does not require the proposed research reading interface. Future UI work is specified in the [redesign handoff, in Chinese](RESEARCH_MAP_REDESIGN.zh-CN.md). Every example below is **synthetic**.

Write for a researcher who may not have written the code or run the experiments. They need to understand the question, the routes, the evidence behind current judgments and the next useful question.

## 1. Establish the task's scope

Identify whether the task is initial mapping, organizing existing material, continuing a route or adding one finding. Follow the user's existing authorization. Organizing experiment code does not authorize running experiments; recommending routes does not automatically authorize writing or reorganizing a map.

Read the project objective and global routes before focusing on a branch. Replace PID/NID below with real identifiers; connection setup is in AI_USAGE:

```bash
python3 tools/researchmap.py project PID
python3 tools/researchmap.py context PID --format json
python3 tools/researchmap.py graph PID
python3 tools/researchmap.py context PID --focus NID --format json
python3 tools/researchmap.py node PID NID
python3 tools/researchmap.py relations PID NID
```

`graph` supplies parent IDs and ordering, not full node content. Current `context` omits rationale, details_md and full evidence. Use `node` to read the focus, relevant route summaries and key source nodes. Search results, omitted records and the first relation page do not represent the whole history. Follow omitted_counts, continuations and pagination before making claims about coverage.

Start with a short account of the objective, existing routes, focus, known findings and gaps. Mark routine assumptions and continue. Ask only when missing information would materially change the direction; do not request confirmation for every node.

## 2. Establish the main routes first

Prepare a route outline before initial mapping or substantial reorganization. Reuse a reasonable existing structure.

| Element | What to explain |
| --- | --- |
| Project question | The phenomenon to explain or improve, success criteria and constraints |
| Main routes | The mechanism, bottleneck or explanation each route addresses, and how routes differ |
| Basis | Existing sources, observations or an explicitly untested hypothesis |
| Key subquestions | What is worth resolving first and how it affects a choice |
| Continue/stop conditions | What observation would justify continuing, revising, pausing or changing direction; unknown conditions remain open |

Usually begin with 2–5 distinct routes supported by the available material. One good route is enough when alternatives have no basis. Divide each into a few necessary subquestions, then deepen the current focus. Do not fill every route to the same depth.

Synthetic project: improve retrieval evidence coverage while controlling irrelevant results.

- Route A: improve query expression; investigate missed evidence caused by terminology differences.
- Route B: improve result selection; investigate how candidate ranking changes useful evidence.
- Route C: examine the evaluation set; check whether coverage measures the research need.

“Preprocessing code,” “experiment scripts” and “results folder” can categorize source material. They rarely explain a top-level research direction.

## 3. Organize by question and explain the reasoning links

A top-level route is an ordinary question/idea with `parent_id=null`. Below it, use the existing four kinds for subquestions, hypotheses, comparisons, attempts and findings:

| Content role | Usual kind | Example |
| --- | --- | --- |
| Route or subquestion | question | Which missed results come from terminology differences? |
| Hypothesis or proposed method | idea | Controlled synonym expansion may recover terminology misses |
| Exploration that distinguishes alternatives | attempt | Compare original queries with controlled expansion on a fixed set |
| Independently useful knowledge | finding | In the synthetic comparison, expansion adds relevant and irrelevant hits |

**The tree expresses primary ownership.** A new question about when to trigger expansion can belong under its broader question, with a motivates relation from the failed attempt that prompted it. Successive work need not always become a child of the previous attempt.

| Relation | Meaning of source → target |
| --- | --- |
| motivates | Earlier question/finding → the new question/method it prompted |
| supports | Evidence-bearing node → the limited claim it supports |
| contradicts | Counter-evidence node → the limited claim it challenges |
| depends_on | Work requiring a prerequisite → that prerequisite |
| related | Associated content without a justified stronger claim; undirected |

Write a specific reason, such as “The noise introduced by expansion makes its triggering conditions worth investigating.” “Related” or “next experiment” alone does not explain the connection. Never invent causality to make the map appear coherent.

A possible deeper structure:

```text
Improve query expression
  └─ Which misses come from terminology differences?
       └─ Can controlled synonym expansion recover evidence?
            └─ Comparison on a fixed evaluation set
                 └─ Which queries introduce extra noise?
                      └─ Do ambiguous terms shift the intended meaning?
                           └─ Can sense constraints retain the benefit? (untested)
```

Explain each transition through rationale/decision or actual relations. Without observations or analysis, subsequent questions remain untested; the example is not evidence. Depth is not a quota. A route may stop at level 2 or go much deeper when warranted; the current structural limit is 64.

## 4. Make each node understandable

| Field | Content |
| --- | --- |
| title, up to 80 characters | A question, method difference or limited finding; more than a filename, run ID or parameter string |
| summary, up to 280 characters | A plain-language purpose/change, current understanding and key limitation |
| rationale, up to 2000 characters | Why this follows from earlier work, which explanations it distinguishes and the approach |
| finding, up to 2000 characters | Direct observations, or an explicit lack of results/confirmed execution |
| decision, up to 2000 characters | Interpretation, tradeoff and next step, including what would change the judgment |
| scope, up to 1000 characters | Actual or proposed conditions, clearly distinguished, and uncovered cases |
| details_md | Method detail, provenance, code purpose, comparison, execution and reproduction information |
| evidence | Sources for specific claims; label explains their use, note explains provenance and unverified parts |

Optional technical-body outline; these headings are writing aids, not an application parser contract:

```markdown
## Question
What does this method or source help distinguish?
## Method and comparison
Inputs, outputs, controls and success criteria; identify unexecuted parts.
## Sources and execution
What was inspected, what it establishes and what is missing.
## Observations and interpretations
Separate observations from competing explanations.
## Next question and decision criteria
What is worth resolving next, and why.
```

Keep long logs out of summaries. Explain the relevant behavior and cite precise sources instead of copying entire programs.

## 5. Check what experiment code actually establishes

| Available material | Appropriate record |
| --- | --- |
| Proposal only | Hypothesis and validation design, usually unexplored |
| Code without execution evidence | Implemented X to test Y; execution unconfirmed and effectiveness unknown. The effect remains unexplored, or in_progress when exploration is actually underway |
| Execution log without valid metrics/controls | Describe the reported execution and gaps; the conclusion is usually inconclusive |
| Preliminary positive observations | Cite sources, conditions and limits; promising may be appropriate |
| Evidence for a limited judgment | supported/not_supported with scope, finding, decision and evidence |
| Recollection or inaccessible reference | Label as recollection/unverified source; never present it as personally verified fact |

These are writing distinctions, not new API status values. Code existing does not establish execution; a successful run does not establish effectiveness; an AI claiming completion does not supply results. Code can support a claim about implementation behavior, but cannot alone turn an effectiveness hypothesis green.

Do not run code merely to complete the record. State any needed experiment as a next step and follow the user's execution authorization. Environment failures usually mean inconclusive, not failure of a research direction. Theoretical or literature work should cite its actual arguments without pretending to be an experiment.

Synthetic rewrites:

| Before | After |
| --- | --- |
| Title: expand_v3.py; summary: experiment code completed | Title: Can controlled expansion reduce terminology misses? Summary: Controlled synonym expansion is implemented to compare coverage and noise; no verifiable run record is available, so effectiveness remains unknown. |
| Title: run_07; summary: poor result | Title: Does the coverage gain from expansion introduce noise? Summary: Within this synthetic comparison, relevant and irrelevant hits both increased; next examine which queries need expansion constraints. This wording requires an actual source in a real project. |

For a code reference, explain purpose, inputs/outputs, the change from other methods, the research question and what is known about execution. A path is a location reference; the app does not open or execute it.

## 6. Maintain continuity with each update

Explain why this step was taken, what was actually learned and how it affects the next step.

- Update the same node for additional results or corrections under the same hypothesis and method; parameter scans usually belong in a result table.
- Create a new node for a different mechanism hypothesis, substantial method change or materially different conditions. Preserve the previous result.
- Use a finding and explicit relations for knowledge reused across routes; copying it does not create independent evidence.
- When an observation changes a route's judgment, review its summary/decision. Update affected ancestors within the authorized task, leaving unrelated branches alone.
- Do not rewrite route summaries when the judgment is unchanged. A route's status reflects its own claim and evidence, not the colors of its children.
- Preserve negative results, conditions, evidence and reasons to stop or continue. Put a pause decision in decision; archiving does not mean failure.

Useful route summary: “This route addresses X. Under Y we currently know Z, based on node/source A. B remains unresolved, so next investigate C.” Keep unknown parts explicit.

## 7. Organize an existing project

First inventory existing IDs, sources, understandable meaning, confirmed execution, proposed routes and uncertainty. Draft one representative route and check its readability before extending the approach within the authorized scope.

Preserve IDs, history, evidence, versions and human notes. Use node.move for ownership and node.update for titles, summaries and necessary explanation. Do not delete the map and rebuild it to obtain a clean appearance. Material without sources remains unverified; filenames are not experiment results.

When structural organization is already authorized, routine placement decisions do not need individual approval. Stop for choices outside that scope, such as major route decisions, bulk archiving or access to real databases. Repository development uses scratch data only; real research content must not enter the repository.

## 8. Commit and read back

Follow the full [AI_USAGE](AI_USAGE.md) protocol: read a baseline, prepare a stable request, dry-run, commit and read back.

1. Check each new node's parent route, research meaning and source. Create parents before children, and relations after endpoints.
2. Explicitly set expected_revision from content you have read. The CLI filling a current revision does not establish that you understood that revision. Recheck affected content if your reads span revisions.
3. Make each commit one understandable research increment, with at most 100 operations. Nodes, relations and necessary route-summary updates can be atomic. Split larger reorganizations into coherent batches.
4. Dry-run checks structure and required fields, not scientific truth or readability. Retry network failures with the same request identity. After a 409, read and merge; do not just refresh the revision to overwrite others.
5. Read back changed nodes and relations to verify direction, ownership, scope, status and summaries. Inspect organization in the current map views when available. Do not claim visual acceptance without a browser check.

Review whether routes describe research, nodes add independent meaning, transitions have a basis, code has been mistaken for results, unknowns and negative results remain visible, and the change can be explained without reading code. List unresolved gaps honestly.

## 9. Hand off to the research lead

Use a brief explanation, with node IDs or links as needed:

1. **Current route:** what question is being addressed and why this route comes first.
2. **New understanding:** what was actually learned and the evidence's scope; explicitly say when nothing was executed.
3. **Effect on the route:** which judgment changed and which alternatives remain viable.
4. **Next question:** the most useful unresolved question and why it matters.
5. **Researcher decisions:** only significant questions about direction, cost or authorization; omit if none.

“Added 18 nodes and organized 12 scripts” is not a research handoff. Change lists and exports support traceability but do not replace the explanation.

## 10. Instruction to give a content-organizing AI

> Read docs/RESEARCH_AUTHORING.md and docs/AI_USAGE.md. Organize the research map for PROJECT_ID within this task's authorized scope.
>
> First read the objective, global routes and current branch; explain the main questions and source gaps. Establish justified routes, divide them into subquestions and deepen the current focus. Preserve a reasonable existing structure. Do not organize top-level routes by script, date or run ID, or aim for a node count or depth quota.
>
> Write titles and summaries for someone who did not perform the work. Explain motivation, observations and consequences for the next step; put code and execution detail in the body and evidence. Distinguish proposals, implementation, execution, observation and interpretation. Missing execution evidence means unknown results. This task does not automatically authorize experiments.
>
> Use the tree for ownership and reasoned relations for research continuity. Preserve negative results, human notes, sources, IDs and history. Update relevant route summaries only when understanding changes; do not propagate statuses. Follow baseline reads, dry-run, idempotent commits, conflict handling and readback.
>
> Finish with the current route, new understanding, its effect and one justified next question, identifying unverified parts. If the task requests planning only, deliver the route outline and proposed changes without writing them.
