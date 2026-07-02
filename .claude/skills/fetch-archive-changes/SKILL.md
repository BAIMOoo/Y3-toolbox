---
name: fetch-archive-changes
description: Resolve one or more game player nicknames (including names with #suffix such as Elias#5784) or raw aid values, then fetch MapArchiveUpload/archive_diff archive-change logs from logtail for a required map id and time range. Use when the user asks to pull, export, download, collect, or fetch archive change logs from logtail by player nickname or aid, especially for long ranges that may require windowing, scroll export, retries, completeness summaries, or sending the generated zip to an explicitly specified email recipient. If the map id is missing, ask for it before fetching.
allowed-tools: [Bash, Read, Write]
---

# Fetch Archive Changes

Use the bundled script for the whole operation. Do not rewrite ad hoc logtail loops unless the script itself is broken.

## Workflow

1. Confirm required inputs before running: players or aid values, date/time range, and `map-id`.
   - `map-id` is required. If the user did not provide it, ask exactly one concise question for the map id and do not fetch until answered.
2. Normalize the requested range to logtail format: `YYYY.MM.DD-HH:mm:ss`.
   - Treat the end time as exclusive. For April 7 through May 20 inclusive, use `2026.04.07-00:00:00` to `2026.05.21-00:00:00`.
3. Run `scripts/fetch_archive_changes.py` with all players, required `--map-id`, and an output directory.
   - Pass all players after one `--players` flag, for example `--players 'A#1111' 'B#2222' '30334591'`.
   - The helper also accepts repeated `--players` flags for backward compatibility, but prefer the single-flag form to avoid shell/template mistakes.
   - Prefer grouped output directories under `archive-changes/` to avoid cluttering the project root.
   - If `--out-dir` is omitted, the script defaults to `archive-changes/archive-change-<date>-<n>players`.
   - In WSL, use the same command; the script auto-bridges Windows `logtail.exe` through `/init powershell.exe -File scripts/run_logtail.ps1` and auto-discovers `C:\Users\*\.logtail.conf` when available.
4. Let the script resolve nicknames and fetch logs.
   - Raw numeric aid values skip nickname resolution.
   - Nicknames with suffixes such as `PlayerName#2678` are resolved through `up5_prod_up1_game_server` first, because archive index `up5_prod` often lacks reliable nickname mapping.
5. For Agent 任务中心 / runner jobs, keep all CSV and summary files on disk for evidence, but expose only the generated zip as the user-downloadable artifact.
   - Do not delete source/intermediate output files as cleanup.
   - `result-manifest.json` for runner jobs should list only the `.zip` in `artifacts`; the zip contains the CSVs and summaries.
6. If the user explicitly says to send/export/email the result to a specific email address, pass `--email-to '<recipient@example.com>'`.
   - Only send when a concrete recipient email is present in the user request or follow-up; do not infer one except when the user says to send to the already-configured/self email.
   - `--email-to` requires zip output and sends only after all CSVs, summaries, and the zip are written.
   - Use the local `.local-tools/mail/config/muttrc` automatically when present, or pass `--mail-muttrc` / `--mail-mutt` for another configured mail client.
7. Report output folder, each aid, matched log counts, first/last log time, any `problem_windows`, zip path, and email recipient/send status when email was requested.

## Command Template

From the project root:

```bash
PYTHONUTF8=1 python3 .claude/skills/fetch-archive-changes/scripts/fetch_archive_changes.py \
  --players 'PlayerName#2678' 'AnotherPlayer#1234' \
  --map-id '204521' \
  --from '2026.04.07-00:00:00' \
  --to '2026.05.21-00:00:00' \
  --out-dir './archive-changes/archive-change-204521-20260407-20260520-liekai'
```

If the user explicitly provides an email recipient, keep zip enabled and add:

```bash
--email-to 'recipient@example.com'
```

Defaults:

- logtail: `D:\logtail-0.4.24-cli-release-windows-amd64\logtail.exe`
  - When running from WSL, if that default path is not mounted at `/mnt/d/...`, the script also checks `C:\logtail-0.4.24-cli-release-windows-amd64\logtail.exe`.
  - Use `--logtail-conf` only to override config discovery; otherwise WSL auto-detects `C:\Users\*\.logtail.conf`.
- archive index: `up5_prod`
- nickname resolve index: `up5_prod_up1_game_server`
- primary window: 48 hours
- retry window: 6 hours

## WSL / Windows Logtail Behavior

The script contains the WSL workaround learned from real runs:

- Do **not** hand-create wrapper scripts for WSL. The script now resolves Windows paths and invokes logtail via bundled `scripts/run_logtail.ps1`.
- Direct `/init /mnt/d/.../logtail.exe` can hang or fail to pass arguments correctly.
- Do **not** use `/init cmd.exe /C <windows-logtail>` for this task: in a real run it launched logtail but silently failed to apply `-s/--search`, so impossible search terms still returned generic time-range logs.
- The PowerShell bridge is the known-good path because `-File ... @args` preserves Logtail argv; validate with a negative search if you suspect bridge issues.
- Direct Windows `.exe` execution may fail with `Exec format error` if WSL binfmt interop is not registered; this is handled automatically.
- If nickname resolution is slow, prefer raw numeric aid when known. Raw aid skips the game-server nickname lookup. Example from a known run: `魔兽我最强#1529` resolved to aid `31020529`.
- Large outputs are still inherently slow: one 2026-05-19 through 2026-05-26 17:00 run on map `204521` produced 58,172 matched rows and a ~50 MB CSV, even with WSL fixed.

### WSL Bridge Sanity Check

If a WSL run seems suspicious, run a quick negative/positive check before the full export:

```bash
PYTHONUTF8=1 python3 .claude/skills/fetch-archive-changes/scripts/fetch_archive_changes.py \
  --players '30144230' \
  --map-id '204521' \
  --from '2026.05.25-00:00:00' \
  --to '2026.05.25-00:10:00' \
  --no-zip
```

For lower-level troubleshooting, a direct Logtail impossible search must return zero output. If it returns unrelated logs, stop and fix the bridge before exporting.

## Long Range / Large Output Behavior

The script is designed around observed logtail failure modes:

- Logtail rejects ranges larger than 10 days, so the script windows the requested range.
- Large normal queries can time out or hit the 10,000-line limit.
- Long primary windows use scroll export automatically; scroll split count is guarded so `primary_window_hours / scroll_out_step_hours <= 10`.
- Windows with timeouts, shard failures, `max split count exceeded`, or hit-limit signals are retried with smaller normal-query windows.
- Results are de-duplicated by exact raw log line after retries.

Use defaults for broad date ranges. For short smoke tests, `--no-use-scroll --no-zip` is faster.

## Output Contract

The output directory contains:

- One `{aid}_{nickname}_archive_changes.csv` per player.
- One `{aid}_{nickname}_fetch_summary.csv` per player with window-level evidence.
- `fetch_summary.csv` with per-player totals, first/last log time, and `problem_windows`.
- `aid_nickname_mapping.csv` with `aid,nickname,input_name`.
- A zip of final deliverables by default. In Agent 任务中心, this zip is the only user-downloadable artifact; loose CSV/summary files remain in the job folder but are not exposed as separate downloads.
- When `--email-to` is used, the script sends that zip after export and prints `email -> <recipient>` on success.

Raw logs are not written by default; pass `--write-raw` only when raw evidence is needed.

## Validation Before Reporting

Before claiming completion, inspect the script output and summaries:

- Confirm `matched_log_count` for each player.
- Confirm first/last log time.
- If email was requested, confirm the script printed `email -> ...`; if sending fails, report that export still completed and include the zip path plus the mail error.
- If `problem_windows > 0`, open the per-player summary and report the affected windows and whether retries recovered rows.
- If a requested end date has no rows, consider a small 6-hour/day spot check and state the zero-result evidence.

## Notes

- If `nickname#suffix` cannot be resolved exactly, the script now refuses ambiguous candidates instead of choosing the first nickname substring match.
- If automatic resolution is ambiguous, ask for a raw aid or a narrower identifying window only after checking the summary/candidates.
- Do not create extra combined summary formats unless the user asks; use the generated summaries.
