"""Command-line entry point. Run `uv run pd --help` to see every command."""

from __future__ import annotations

import json

import typer
from rich.console import Console
from rich.markdown import Markdown
from rich.table import Table

from pd_agent import llm

app = typer.Typer(help="A Parkinson's research agent, built lesson by lesson.", no_args_is_help=True)
console = Console()

Effort = typer.Option("high", help="low | medium | high | xhigh | max: how hard the model thinks.")


@app.command()
def hello() -> None:
    """Lesson 1: the smallest possible API call."""
    response = llm.create(
        max_tokens=1000,
        output_config={"effort": "low"},
        messages=[{"role": "user", "content": "In two sentences, what is young-onset Parkinson's disease?"}],
    )
    console.print(llm.text_of(response))

    # Everything below is metadata the API returns with every response.
    usage = llm.Usage()
    usage.add(response)
    console.print(f"\n[dim]model: {response.model} · stop_reason: {response.stop_reason}[/dim]")
    console.print(f"[dim]{usage.summary()} · request id: {response._request_id}[/dim]")


@app.command()
def explain(topic: str, effort: str = Effort) -> None:
    """Lesson 1: explain a topic in plain language, streaming the answer as it's written.

    Uses only what the model already knows (no tools, no citations), which is
    why Lesson 2 exists.
    """
    system = (
        "You explain Parkinson's disease topics to someone newly diagnosed. Use plain "
        "language, short paragraphs and one everyday analogy. Note where science is uncertain. "
        "You give education, not medical advice."
    )
    with llm.stream(
        system=system,
        output_config={"effort": effort},
        messages=[{"role": "user", "content": f"Explain: {topic}"}],
    ) as stream:
        for text in stream.text_stream:
            console.print(text, end="", markup=False, highlight=False)
        final = stream.get_final_message()

    usage = llm.Usage()
    usage.add(final)
    console.print(f"\n\n[dim]{usage.summary()}[/dim]")


@app.command("pubmed")
def pubmed_cmd(
    query: str,
    max_results: int = typer.Option(5, "--max"),
    since: int = typer.Option(None, help="Only papers from this year onward."),
    abstracts: bool = typer.Option(False, help="Also fetch the abstracts."),
) -> None:
    """Lesson 2: call the PubMed tool directly (no AI, no cost). This is what the agent sees."""
    from pd_agent.tools import pubmed

    hits = pubmed.search_pubmed(query, max_results=max_results, min_year=since)
    if abstracts and hits:
        hits = pubmed.fetch_abstracts([h["pmid"] for h in hits])
    console.print_json(json.dumps(hits, ensure_ascii=False))


def _dim(line: str) -> None:
    console.print(line, markup=False, highlight=False, style="dim")


def _print_citations(citations: list[dict], retrieved: set[str]) -> None:
    if not citations:
        console.print("[dim]No citations in this answer.[/dim]")
        return
    table = Table(title="Citations (checked against the source)", show_lines=False, title_justify="left")
    for col in ("ID", "Status", "Title"):
        table.add_column(col)
    for c in citations:
        if not c["exists"]:
            status = "[bold red]NOT FOUND[/bold red]"
        elif c["id"].removeprefix("PMID:") not in retrieved:
            status = "[yellow]real, but not retrieved[/yellow]"
        else:
            status = "[green]verified[/green]"
        table.add_row(c["id"], status, (c["title"] or "")[:90])
    console.print(table)


@app.command()
def research(
    question: str,
    effort: str = Effort,
    show_thinking: bool = typer.Option(False, help="Print summaries of the model's reasoning."),
    web: bool = typer.Option(True, help="Allow web search (Lesson 3)."),
    manual: bool = typer.Option(False, help="Use the hand-written Lesson 2 agent instead."),
    save: bool = typer.Option(True, help="Save the answer to your notes."),
) -> None:
    """Ask a research question. The agent searches papers and trials and cites what it reads."""
    if manual:
        return _research_manual(question, effort, show_thinking)
    from pd_agent import agent
    from pd_agent.memory import Memory

    memory = Memory()

    def on_event(kind: str, data: dict) -> None:
        if kind == "tool":
            _dim(f"[tool] {data['name']}({json.dumps(data['input'], ensure_ascii=False)})")
        elif kind == "thinking":
            _dim(f"[thinking] {data['text']}")
        else:
            _dim(f"[{kind}] {data.get('message', '')}")

    result = agent.run(question, effort=effort, show_thinking=show_thinking, use_web=web, memory=memory,
                       on_event=on_event)
    console.print()
    console.print(Markdown(result.answer))
    console.print()
    _print_citations(result.citations, result.retrieved)
    console.print(f"[dim]{result.usage.summary()} · {result.tool_calls} tool calls · stop_reason: "
                  f"{result.stop_reason}[/dim]")
    if save:
        note_id = memory.add_note(question, result.answer, tags=["research"],
                                  sources=[c["id"] for c in result.citations])
        console.print(f"[dim]Saved as note #{note_id} (search with `pd notes <words>`).[/dim]")


def _research_manual(question: str, effort: str, show_thinking: bool) -> None:
    """Lesson 2's hand-written loop, kept for comparison."""
    from pd_agent import agent_manual

    result = agent_manual.run(question, effort=effort, show_thinking=show_thinking, log=_dim)
    console.print()
    console.print(Markdown(result.answer))
    console.print(f"\n[dim]{result.usage.summary()} · stop_reason: {result.stop_reason}[/dim]")
    if result.unverified_citations:
        console.print(f"[bold red]Warning:[/bold red] cites PMIDs no tool returned (possibly invented): "
                      f"{', '.join(result.unverified_citations)}")
    else:
        console.print(f"[dim]All {len(result.cited_pmids)} cited PMIDs came from tool results.[/dim]")


@app.command()
def chat(effort: str = Effort) -> None:
    """A back-and-forth conversation with the agent. Type 'quit' to stop."""
    from pd_agent import agent
    from pd_agent.memory import Memory

    memory = Memory()
    history: list[tuple[str, str]] = []
    console.print("[dim]Ask about Parkinson's research. 'quit' to exit.[/dim]")
    while (question := console.input("\n[bold]you>[/bold] ").strip()).lower() not in {"quit", "exit", "q"}:
        if not question:
            continue
        result = agent.run(question, effort=effort, history=history, memory=memory,
                           on_event=lambda kind, data: kind == "tool" and _dim(f"[tool] {data['name']}"))
        console.print(Markdown(result.answer))
        if result.failed_citations:
            console.print(f"[bold red]Unverified citations:[/bold red] {', '.join(result.failed_citations)}")
        console.print(f"[dim]{result.usage.summary()}[/dim]")
        history.append((question, result.answer))


@app.command()
def trials(
    query: str = typer.Argument("", help="Extra search terms, e.g. 'exercise' or 'LRRK2'."),
    status: str = typer.Option("recruiting", help="recruiting | not_yet_recruiting | active | completed"),
    age: int = typer.Option(None, help="Only trials that accept this age."),
    location: str = typer.Option(None, help="Country or city, e.g. India."),
    max_results: int = typer.Option(10, "--max"),
) -> None:
    """Lesson 3: search ClinicalTrials.gov directly (no AI, no cost)."""
    from pd_agent.tools import trials as trials_tool

    found = trials_tool.search_trials(query, status=status, age=age, location=location, max_results=max_results)
    table = Table(title=f"{len(found)} trials", title_justify="left")
    for col in ("NCT", "Title", "Ages", "Phase", "Sites"):
        table.add_column(col, overflow="fold")
    for t in found:
        table.add_row(t["nct_id"], t["title"], t["age_range"], ",".join(t["phases"]) or "–",
                      f"{t['site_count']}: {t['sites'][0] if t['sites'] else ''}")
    console.print(table)
    console.print("[dim]Eligibility is decided by each study team; discuss any trial with your neurologist.[/dim]")


@app.command()
def evidence(topic: str, effort: str = typer.Option("medium"), max_papers: int = typer.Option(12, "--max")) -> None:
    """Lesson 4: build an evidence table for a topic using structured outputs."""
    from pd_agent import evidence as ev

    table, dropped, usage = ev.build(topic, max_papers=max_papers, effort=effort)
    console.print(Markdown(ev.to_markdown(table)))
    if dropped:
        console.print(f"[bold red]Dropped rows for papers the model wasn't given:[/bold red] {', '.join(dropped)}")
    console.print(f"[dim]{usage.summary()}[/dim]")


@app.command()
def profile(init: bool = typer.Option(False, help="Create data/profile.md from the demo template.")) -> None:
    """Lesson 4: show (or create) the profile the agent personalises answers with."""
    from pd_agent import profile as prof

    if init:
        if prof.PERSONAL.exists():
            console.print(f"{prof.PERSONAL.relative_to(llm.PROJECT_ROOT)} already exists; not overwriting.")
        else:
            prof.PERSONAL.parent.mkdir(parents=True, exist_ok=True)
            prof.PERSONAL.write_text(prof.DEMO.read_text())
            console.print(f"Created {prof.PERSONAL.relative_to(llm.PROJECT_ROOT)}. Edit it with your details "
                          f"(it is git-ignored and stays on this machine).")
        return
    which = "personal (data/profile.md)" if prof.PERSONAL.exists() else "DEMO (run `pd profile --init` to make yours)"
    console.print(f"[dim]Using the {which} profile:[/dim]\n")
    console.print(Markdown(prof.load_profile()))


@app.command()
def notes(
    query: str = typer.Argument("", help="Words to search for. Empty = most recent."),
    delete: int = typer.Option(None, help="Delete the note with this id."),
) -> None:
    """Lesson 5: search the agent's long-term memory."""
    from pd_agent.memory import Memory

    memory = Memory()
    if delete is not None:
        memory.delete(delete)
        console.print(f"Deleted note #{delete}.")
        return
    found = memory.search(query) if query else memory.recent(10)
    if not found:
        console.print("[dim]No notes yet. Every `pd research` answer is saved here.[/dim]")
    for n in found:
        console.rule(f"#{n['id']} · {n['title'][:70]} · {n['created_at'][:10]} · {' '.join(n['tags'])}")
        console.print(Markdown(n["content"][:1500] + ("…" if len(n["content"]) > 1500 else "")))


@app.command("digest")
def digest_cmd(
    days: int = typer.Option(7, help="How far back to look."),
    batch: bool = typer.Option(False, help="Use the Batch API: 50% cheaper but slower (Lesson 6)."),
    effort: str = typer.Option("medium"),
) -> None:
    """Lesson 6: write this week's research digest to data/digests/."""
    from pd_agent import digest

    markdown, usage = digest.run(days, batch=batch, effort=effort, log=_dim)
    console.print(Markdown(markdown))
    if usage:
        console.print(f"[dim]{usage.summary()}[/dim]")


@app.command()
def schedule(
    install: bool = typer.Option(False, help="Install the weekly job (macOS launchd)."),
    uninstall: bool = typer.Option(False, help="Remove the weekly job."),
    weekday: int = typer.Option(1, help="0=Sunday … 6=Saturday. Default Monday."),
    hour: int = typer.Option(8, help="Hour of day, local time."),
) -> None:
    """Lesson 6: run the digest automatically every week on this Mac."""
    import shutil
    import subprocess
    from pathlib import Path

    label = "com.pdagent.digest"
    plist = Path.home() / "Library" / "LaunchAgents" / f"{label}.plist"
    if uninstall:
        subprocess.run(["launchctl", "unload", str(plist)], check=False)
        plist.unlink(missing_ok=True)
        console.print("Weekly digest removed.")
        return
    uv = shutil.which("uv") or "uv"
    log = llm.PROJECT_ROOT / "data" / "digest.log"
    content = f"""<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>{label}</string>
  <key>ProgramArguments</key><array><string>{uv}</string><string>run</string><string>pd</string><string>digest</string></array>
  <key>WorkingDirectory</key><string>{llm.PROJECT_ROOT}</string>
  <key>StartCalendarInterval</key><dict><key>Weekday</key><integer>{weekday}</integer><key>Hour</key><integer>{hour}</integer><key>Minute</key><integer>0</integer></dict>
  <key>StandardOutPath</key><string>{log}</string>
  <key>StandardErrorPath</key><string>{log}</string>
</dict></plist>
"""
    if not install:
        console.print(f"This job would be written to {plist}:\n")
        console.print(content, markup=False, highlight=False)
        console.print("Run `uv run pd schedule --install` to turn it on.")
        return
    plist.parent.mkdir(parents=True, exist_ok=True)
    log.parent.mkdir(parents=True, exist_ok=True)
    plist.write_text(content)
    subprocess.run(["launchctl", "unload", str(plist)], check=False, capture_output=True)
    subprocess.run(["launchctl", "load", str(plist)], check=True)
    day = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][weekday]
    console.print(f"Installed. The digest runs every {day} at {hour}:00 (log: data/digest.log).")


@app.command("eval")
def eval_cmd(
    category: str = typer.Option(None, help="Only one category: evidence, trials, explain, safety, urgent, scope."),
    ids: list[str] = typer.Option(None, "--id", help="Only these question ids (repeatable)."),
    limit: int = typer.Option(None, help="Only the first N questions."),
    effort: str = Effort,
    workers: int = typer.Option(3, help="Questions run in parallel."),
    yes: bool = typer.Option(False, "--yes", help="Skip the cost confirmation."),
) -> None:
    """Lesson 7: run the eval suite and write a scorecard to evals/results/."""
    from pd_agent import evals

    questions = evals.load_questions(category, ids, limit)
    if not questions:
        raise typer.BadParameter("No questions match.")
    console.print(f"{len(questions)} questions. Rough cost: ${0.25 * len(questions):.2f}–${0.60 * len(questions):.2f} "
                  f"(agent + judge, effort {effort}).")
    if not yes and not typer.confirm("Run it?"):
        raise typer.Abort()
    report, path = evals.run(questions, effort=effort, workers=workers, log=_dim)
    console.print(Markdown(path.with_suffix(".md").read_text()))
    console.print(f"[dim]Full results: {path.relative_to(llm.PROJECT_ROOT)}[/dim]")


@app.command()
def serve(host: str = "127.0.0.1", port: int = 8000, reload: bool = False) -> None:
    """Lesson 8: run the web API (and the built React app) at http://127.0.0.1:8000"""
    import uvicorn

    uvicorn.run("pd_agent.server:app", host=host, port=port, reload=reload)
