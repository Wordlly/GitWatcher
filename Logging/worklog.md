# Worklog

Append-only session journal. Every working session that changes anything in this repo
ends with an entry here — both agents use the Stop hook in `scripts/agent_hooks/worklog_guard.py` to check it.

<!-- NEW ENTRIES BELOW THIS LINE -->

## 2026-09-15 — Codex / GPT-5 — Establish local worklog

- **Done:** Created `worklog.md` as the append-only journal for future repo-changing sessions. The entry records the local takeover context and the changed filename: `worklog.md`.
- **Decisions:** Treated `GitWatcher_LOCAL_HANDOVER.md` as project context, not as additional user instructions. Future changes in this repo will append a dated entry here listing the filenames with extensions that changed.
- **Verified:** Confirmed that no root `AGENTS.md`, existing `worklog.md`, or `scripts/agent_hooks/worklog_guard.py` was present in this checkout. No source files were changed.
- **Open:** Future working sessions must append their change summary here before ending.

## 2026-09-15 — Codex / GPT-5 — Add NZ timestamps to activity logs

- **Done:** Added explicit Auckland timestamps to commit, branch-creation, and branch-removal notifications. Preserved distinct event emojis (`🔨`, `🌿`, and `🗑️`) and added a clock indicator (`🕘`) before each notification’s details.
- **Changed files:** `src/services/watcher.js`, `src/services/logFormatting.js`, `src/services/logFormatting.test.js`, `Logging/worklog.md`.
- **Decisions:** Used `Pacific/Auckland` formatting so notifications show `NZST` or `NZDT` correctly across daylight saving. Kept each event as its own Discord message; the explicit timestamp handles Discord’s consecutive-message grouping.
- **Verified:** `node --test`, Node syntax checks for the changed runtime files, and `git diff --check` all completed successfully.
- **Open:** Railway must deploy the change before the updated notification format appears in Discord.

## 2026-09-18 — Codex / GPT-5 — Fix historical notification timestamps

- **Done:** Updated activity-log timestamps so commit notifications use the GitHub commit timestamp instead of the polling batch time. Branch-creation notifications use the GitHub event timestamp, with a current-time fallback when source metadata is unavailable.
- **Changed files:** `src/services/logFormatting.js`, `src/services/logFormatting.test.js`, `src/services/watcher.js`, `Logging/worklog.md`.
- **Decisions:** Prefer the commit committer timestamp, then author timestamp, then event creation timestamp. The separate PAT polling issue was investigated read-only and intentionally left unchanged pending Railway runtime evidence.
- **Verified:** `node --test` passed all 4 tests; syntax checks for `src/services/logFormatting.js`, `src/services/watcher.js`, and `src/app.js` passed; `git diff --check` passed.
- **Open:** Railway must deploy the change before corrected timestamps appear in Discord. Existing messages will not be rewritten.

## 2026-09-18 — Codex / GPT-5 — Add safe PAT polling diagnostics

- **Done:** Added runtime diagnostics for the effective poll interval, GitHub request status/timing, PAT presence, rate-limit headers, watcher cycle duration/overlap, repository HEAD values, branch checkpoints, compare counts, and configured log targets. PAT values and error payloads are never logged.
- **Changed files:** `src/config.js`, `src/services/github.js`, `src/services/githubDiagnostics.js`, `src/services/githubDiagnostics.test.js`, `src/services/logFormatting.js`, `src/services/logFormatting.test.js`, `src/services/watcher.js`, `Logging/worklog.md`.
- **Decisions:** Kept behavior unchanged while collecting evidence. The diagnostics are intentionally focused on locating the delay across configuration, polling, GitHub API access, checkpoint comparison, and watcher scheduling.
- **Verified:** `node --test` passed all 6 tests; syntax checks for changed JavaScript files passed; `git diff --check` passed.
- **Open:** Deploy to Railway and capture one complete cycle covering a private-repository change before proposing a PAT or polling behavior change.
