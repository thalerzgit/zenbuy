# ZenBuy — Standing RCA / Development / Deploy Process

**Status:** Permanent standing order for all Cursor sessions (local, cloud, mobile).  
**Source of truth:** This file in the GitHub repo (`thalerzgit/zenbuy`).  
**Audience:** Every agent and human coding session for CyberMan / ZenBuy.info.

Supersedes the prior short “push → wait → LANDED” checklist (old steps 0–8 style).  
That checklist is now **Steps 8–10** of this 10-step process.

---

## Principles (always)

- **GitHub `main` is the source of active truth.** Local and cloud worktrees sync from GitHub first.
- **Surgical scope.** Change only what the issue/feature requires; do not orphan, regress, or break adjacent wiring.
- **Minimal code.** Prefer the smallest correct change; optimize inefficient code already in scope.
- **Mobile-aware.** Prompter may be on iOS Cursor (no local repo), laptop, or desktop. Detect and adapt; never assume a writable local clone on mobile.
- **No LANDED until production is verified.**

---

## 10-Step Process

### Step 1 — Synchronize from GitHub

1. Treat **GitHub cloud repositories** as the starting point and source of active truth.
2. Detect whether the prompter is on a **mobile iOS client** (no reliable local-repo support). If a local clone is available and needed, **pull** from GitHub before editing.
3. Confirm branch state (`main` / feature branch), remotes, and that work is based on latest `origin/main` unless the task explicitly continues an open PR branch.

### Step 2 — Full audit & deep research

Do a full audit with deep research and precision. Uncover **all** elements involved, wired, or touching the web app, native app, or platform:

- Code paths, configs, MD/docs, secrets/vars (names only)
- Active **and** deprecated agents, workers, workflows, Actions, processes
- Scheduled tasks / cron jobs
- Cloudflare surface: Workers/Pages, KV, D1, R2, DNS, AI Gateway, etc.

Use this to choose the best entry point for RCA, development, or optimization.

### Step 3 — Highest qualified coding model

Prompt the admin/prompter to **activate/select the highest model available** that is qualified for excellent coding skills — **or** automatically use the top skilled coding LLM / cloud agent available at prompt time when the environment allows.

### Step 4 — Developmental draft / plan

Lay down a precise development plan for the issue or feature:

- Surgical focus on the requested problem/feature only
- Avoid collateral changes to unrelated platform elements
- Explicitly protect adjacent wired mechanisms (no orphans, no regressions)

### Step 5 — Optimize for minimal, non-bloated code

Optimize the plan and implementation so the goal is to **deploy with as little code as possible** and avoid bloat. If code already in scope is inefficient or previously un-optimized, fix it now as part of this effort.

### Step 6 — Admin questions (one at a time)

If answers are required before coding:

- Ask the admin **one question at a time**
- Keep each question brief/concise
- Use technical but layman’s terminology
- Include **your recommendation** in each question
- Continue until all needed answers are received

### Step 7 — Multi-client / multi-repo awareness

The admin may work from:

- Mobile iOS (cloud-only)
- Mobile laptop (local repo)
- Desktop (local repo)
- Various cloud agent repositories/sessions

**Always** honor **GitHub repositories as the latest source of truth** across all of them. Push/pull and merge so no stale local fork becomes the de facto source.

### Step 8 — Push, Actions, Cloudflare deploy

1. Push code changes to GitHub (feature branch → PR → merge to `main` as appropriate).
2. Wait **2–3 minutes** for landing.
3. Confirm GitHub Actions **succeeded**, commit is on **`main`**, and the correct workflow deployed via **Wrangler** to Cloudflare.
4. Validate Cloudflare applied changes in the correct environment (Workers/Pages, KV, D1, R2, DNS, bindings, etc.).

### Step 9 — Production smoke-test & loop

Validate/test that production matches the admin’s intent.

- If unexpected outcome or failure: **loop back to Step 1** with learned facts and repeat until the initial intent is landed correctly.

### Step 10 — Reply with LANDED! executive brief

When complete, end the prompt reply with **`LANDED!`** plus a concise executive brief:

| | |
|--|--|
| **A)** | What was asked for |
| **B)** | Steps taken to comply |
| **C)** | Problems / resolutions (if any) |
| **D)** | Final deployment elements |
| **E)** | What’s working and how it works now |

Do **not** post `LANDED!` until Steps 8–9 are green.

---

## Where this lives (permanent)

| Location | Role |
|----------|------|
| `docs/STANDING_DEV_PROCESS.md` | Canonical copy in GitHub (truth) |
| `.cursor/rules/standing-dev-process.mdc` | Always-on Cursor rule for all IDE/cloud sessions on this repo |
| Cursor self-store `workflow.md` | Cloud-agent personal standing note (mirrors this process) |

Update all three together when this process changes.
