# Job Finder v2

Personal job-finding desktop app: an **experience engine** that digests your
work history into reusable line items, **semantic cross-industry discovery**
(pay + WFH weighted), a **browser extension** for hostile boards (Indeed,
CareerBuilder), auto-tailored applications, and a **conversational agent** that
can drive and extend the app.

See **[PLAN.md](PLAN.md)** for the full architecture and design decisions.

## Stack

- **Electron + React + TypeScript + Vite** (forked from `../claw-deck`'s skeleton)
- **Node main process** with IPC + `better-sqlite3`
- **LLM:** provider-agnostic — default Ollama Cloud `gemini-3-flash-preview:cloud`
  via the OpenAI-compatible `/v1` path, with an Anthropic → local-model fallback
  chain (`electron/llm/provider.ts`)
- **Vitest** for tests (the self-extension sandbox gate depends on a real suite)

## Status — all 15 phases complete ✅ (101 tests passing)

End-to-end loop: **scan** ATS boards (Greenhouse/Ashby/Lever) + harvest hostile
boards via the **extension** (Indeed/CareerBuilder) → **digest** your résumés
into reusable line items + infer role fits → **embed + discover** semantic,
pay/WFH-weighted matches (incl. ones you didn't search for) → **tailor** CV +
cover letters → **bulk-apply** review queue (blocklist + liveness gated) →
**kanban pipeline** with drag-through states → **Gmail** ingests replies and
auto-advances status → **career intel** (salary/company/lateral/certs) →
**follow-up nudges** + **interview prep**. Plus a **conversational agent** that
drives the app, and **self-extension** (the agent writes its own code, sandboxed,
approval-gated).

Tabs: Dashboard · Search · Pipeline · Experience · Boards · Career · Agent ·
Self-extend · Settings.

## Dev

```bash
npm install
npm run dev      # vite (5173) + electron
npm test         # vitest (101 tests)
npm run build    # renderer + electron
npm run dist     # package a Windows installer (NSIS + portable) → dist-installer/
```

Requires a local [Ollama](https://ollama.com) running (and signed in for `:cloud`
models) + `ollama pull nomic-embed-text` for semantic search. Without Ollama, set
an Anthropic key in Settings to use the fallback chain.

See **[PLAN.md](PLAN.md)** for the full design, the per-phase status (§9), the
enhancement backlog, and **§13 "Action items for Cole"** (Ollama setup, Gmail
OAuth, loading the extension).
