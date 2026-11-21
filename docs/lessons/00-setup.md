# Lesson 0: Setup

**Goal:** a working Python project, an API key, and a first call that proves it all works.

## What got built

| File | Why it exists |
|---|---|
| `pyproject.toml` | The Python version of `package.json`: name, dependencies, and the `pd` command. |
| `uv.lock` | The Python version of `package-lock.json`. Commit it. |
| `.python-version` | Pins Python 3.12 (like `.nvmrc`). Your Mac's built-in Python is 3.9, which is too old for the Anthropic SDK. |
| `.venv/` | The installed packages (like `node_modules/`). Never commit it. |
| `.gitignore` | Keeps `.env` (your key) and `data/` (your health notes) out of git. |
| `.env.example` | Template for `.env`. Committed, with no real values. |

### `uv` is your npm

| You know | Python with uv |
|---|---|
| `npm install` | `uv sync` |
| `npm install foo` | `uv add foo` |
| `npm install -D foo` | `uv add --dev foo` |
| `npx foo` / `npm run foo` | `uv run foo` |
| `node script.js` | `uv run python script.py` |

`uv run` always uses the project's own Python and packages, so you never "activate" anything.

## Your steps

1. **Get an API key.**
   - Go to <https://console.anthropic.com> and sign up.
   - Add a payment method under **Settings → Billing**. Buy a small amount of credit, $5–10 is plenty for weeks of lessons.
   - **Set a spend limit** under **Settings → Limits** (e.g. $20/month), so no bug can run up a bill.
   - Go to **Settings → API Keys → Create Key**. Name it `parkinson-agent-dev` and copy it. It is shown only once.
2. **Put it in `.env`:**
   ```bash
   cp .env.example .env
   open -e .env        # paste the key after ANTHROPIC_API_KEY=
   ```
   Optionally add your email as `NCBI_EMAIL`. PubMed asks API users to identify themselves.
3. **Prove it works:**
   ```bash
   uv run pd hello
   ```
   You should see two sentences about YOPD, then a dim line with token counts and a cost of under a cent.

## Key safety, in one paragraph
An API key is a password that spends money. It lives only in `.env`, which `.gitignore` excludes. Never paste it into code, chat, screenshots, or a GitHub issue. If it ever leaks, delete it in the Console and create a new one; that takes 30 seconds. In interviews, "secrets go in environment variables, never in source" is a basic expectation.

## Health data, in one paragraph
Later lessons store a personal profile and notes in `data/`. That folder is in `.gitignore`, so it never reaches GitHub, even though this repo will be public in your portfolio. The public demo uses a made-up profile. It's worth saying this in your README: handling health data carefully is a strength in medical AI work.
