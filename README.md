# Parkinson's Research Agent

An AI agent that searches the biomedical literature and clinical-trial registries on Parkinson's disease, reads what it finds, and explains the evidence, **citing every claim, checking every citation at its source**, and labelling how strong each finding is.

I built this to learn AI engineering properly, one lesson at a time, on a problem where getting it right matters: a made-up citation in medical research can mislead someone. [`docs/lessons/`](docs/lessons/) walks through the whole build.

> **Not medical advice.** This is an educational tool. It never recommends changing medication, and it points every actionable finding back to a neurologist.

## What it does
| | |
|---|---|
| 🔬 **Research agent** | `pd research "<question>"`: searches PubMed, ClinicalTrials.gov and Europe PMC full text (plus web search for news), reads abstracts, and answers with `[PMID:…]` / `[NCT…]` citations and evidence labels. |
| ✅ **Citation verification** | Every cited ID is looked up at the source after the answer is written: *verified*, *real but not retrieved*, or **NOT FOUND**. |
| 🧪 **Trial finder** | `pd trials exercise --age 42 --location India`: recruiting studies filtered by age and location. |
| 📊 **Evidence tables** | `pd evidence "<topic>"`: structured, schema-validated summaries of reviews and RCTs. |
| 🧠 **Memory** | Answers and notes in a local SQLite full-text index; the agent recalls them in later questions. |
| 📰 **Weekly digest** | `pd digest`: new papers and trials, ranked for relevance to your profile; scheduled with `pd schedule --install`. |
| 📏 **Evals** | `pd eval`: 26 questions (evidence, trials, safety probes, emergencies) graded by code checks and an LLM judge; scorecards in `evals/results/`. |
| 🌐 **Web app** | `pd serve` + React UI that streams the agent's steps live; free **demo mode** without an API key. |
| 🎮 **Patient apps** | `games/`: finger-tapping tracker, voice-loudness practice, dual-task memory game, ON/OFF diary. Accessible, private, offline. |

## Quick start
```bash
# needs uv (https://docs.astral.sh/uv/) and, for the web UI and games, Node 20+
uv sync
cp .env.example .env              # add your ANTHROPIC_API_KEY
uv run pd profile --init          # optional: personalise (data/ is git-ignored)

uv run pd research "What is the evidence that aerobic exercise slows Parkinson's progression?"
uv run pd trials --age 42
uv run pytest                     # offline tests, no key needed
```
Web app: `cd web && npm install && npm run build && cd .. && uv run pd serve`, then open http://127.0.0.1:8000. Games: `cd games && npm install && npm run dev`.

## How it works
```
question ─▶ Claude (claude-opus-5-5) ◀─ tool_use / tool_result ─▶ PubMed · ClinicalTrials.gov · Europe PMC · notes · web
                    │  (SDK Tool Runner loop, tool budget, prompt caching)
                    ▼
            cited answer ─▶ citation verifier (code) ─▶ CLI / web (SSE) / notes
```
More: [docs/architecture.md](docs/architecture.md).

## Learn it lesson by lesson
| # | Lesson | Key ideas |
|---|---|---|
| 0 | [Setup](docs/lessons/00-setup.md) | uv, API keys, secrets and health-data hygiene |
| 1 | [First LLM call](docs/lessons/01-first-call.md) | messages, tokens and cost, effort, streaming, refusals |
| 2 | [Tools and the agent loop](docs/lessons/02-tools-and-agent-loop.md) | tool schemas, a hand-written loop, testing with fake models |
| 3 | [Tool Runner and more tools](docs/lessons/03-tool-runner-and-more-tools.md) | `@beta_tool`, server tools, citation verification, two real data bugs |
| 4 | [Prompting, safety, structured outputs](docs/lessons/04-prompting-safety-structured-outputs.md) | layered safety, Pydantic outputs, prompt caching |
| 5 | [Memory](docs/lessons/05-memory.md) | SQLite FTS5, BM25, RAG, keyword vs embeddings |
| 6 | [Workflow vs agent: weekly digest](docs/lessons/06-workflow-digest.md) | pipelines, Batch API, scheduling |
| 7 | [Evals](docs/lessons/07-evals.md) | code graders, LLM-as-judge, scorecards |
| 8 | [Web app](docs/lessons/08-web-app.md) | FastAPI, Server-Sent Events, demo mode, Docker |
| 9 | [Patient apps and games](docs/lessons/09-patient-apps.md) | accessibility, Web Audio, tremor-tolerant input |

## Repository map
```
src/pd_agent/      agent, tools, memory, digest, evals, server (Python)
tests/             offline tests (fake models, recorded API responses)
evals/             eval questions and scorecards
web/               React UI for the agent
games/             accessible practice and tracking apps
docs/              lessons, architecture
```

## Privacy
Your profile, notes and digests live in `data/`, which is git-ignored and never leaves your machine. Evals and the public demo use a fictional profile. The games keep their data in the browser.

## Stack
Python 3.12 · uv · Anthropic Python SDK (Claude Opus 5.5) · FastAPI · SQLite FTS5 · Pydantic · Typer · pytest + respx · React + TypeScript + Vite · Docker
