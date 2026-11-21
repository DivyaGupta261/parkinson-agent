# Lesson 6: Workflow vs agent, the weekly research digest

**Goal:** know when **not** to build an agent, and build an automated pipeline that runs every week.
**Code:** `src/pd_agent/digest.py`, `pd digest`, `pd schedule`.

```bash
uv run pd digest --days 7         # writes data/digests/YYYY-MM-DD.md
uv run pd digest --batch          # same, via the Batch API (50% cheaper, slower)
uv run pd schedule                # shows the weekly job
uv run pd schedule --install      # runs it every Monday at 08:00
```

## 1. Agent or workflow?
| | Agent | Workflow |
|---|---|---|
| Who decides the steps | the model | your code |
| Good for | open-ended questions ("what's known about X?") | repeatable jobs ("every week, do these steps") |
| Cost and latency | higher, varies | lower, predictable |
| Debugging | read the transcript | normal stack traces |

The digest steps never change:

```
collect (code)      PubMed: 6 topic searches, last N days → abstracts
                    ClinicalTrials.gov: recruiting / not-yet-recruiting trials updated recently
dedupe  (code)      drop anything in the `seen` table (Lesson 5)
rank    (model)     ONE structured-output call: relevance 0–3 + plain summary per item
write   (code)      markdown, sorted by relevance → data/digests/, notes, mark seen
```

The model does the one step that needs judgement: reading abstracts and deciding relevance to *this person*. Everything else is ordinary code. Industry guidance is to start with the simplest thing that works (one call, then a workflow, then an agent) and only move up when you have to.

## 2. Guarding the model's output, again
`render()` ignores any id the model returns that wasn't in the input (`test_digest_render_keeps_relevant_items_sorted` checks an invented `PMID:404`). Same principle as Lessons 3 and 4: **validate the model's claims against what you know in code.**

## 3. The Batch API: half price if you can wait
`rank_with_batch()` sends one request per item as a **batch**. Anthropic processes it asynchronously (usually minutes, at most 24h) at **50% of the price**. We poll until `processing_status == "ended"`, then read results, which arrive **in any order**, so each carries a `custom_id`.

Use batches for anything nobody is waiting on: weekly jobs, evals at scale, back-filling summaries. Note the raw JSON schema with `additionalProperties: false` here: the batch request is a plain dict, so we don't get the Pydantic helper.

## 4. Scheduling on macOS
`pd schedule --install` writes a **launchd** job (macOS's built-in scheduler, its version of cron) to `~/Library/LaunchAgents/com.pdagent.digest.plist` and loads it. Output goes to `data/digest.log`. Remove it with `pd schedule --uninstall`. If the Mac is asleep at the scheduled time, launchd runs the job when it wakes.

## Try this
1. Run `pd digest --days 30` the first time (more to read), then `pd digest` again: "Nothing new".
2. Edit `DEFAULT_TOPICS` to add a topic you care about, such as `parkinson* AND (anxiety OR depression)`.
3. Next week, run `pd digest --batch` and compare its cost with this week's normal run. (Running both on the same week won't work: the second run finds everything already seen.)
4. Open a digest in the web app (Lesson 8) under **Digests**.

## Interview questions you can now answer
- *When would you choose a workflow over an agent?*
- *How would you run LLM work on a schedule, and what does the Batch API trade off?*
- *How do you avoid reprocessing the same items?* (Idempotency via a `seen` table.)
