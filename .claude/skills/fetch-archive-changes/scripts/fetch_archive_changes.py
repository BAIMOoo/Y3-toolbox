#!/usr/bin/env python3
"""Fetch MapArchiveUpload/archive_diff logs from logtail for one or more players.

The script resolves nicknames to aid values, fetches archive-change logs in safe
windows that respect logtail limits, retries failed windows with smaller chunks,
then writes per-player CSVs plus mapping and summary files.
"""
from __future__ import annotations

import argparse
import csv
import json
import os
import platform
import re
import shutil
import subprocess
import zipfile
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path
from typing import Iterable, Sequence

DEFAULT_LOGTAIL = r"D:\logtail-0.4.24-cli-release-windows-amd64\logtail.exe"
DEFAULT_WINDOWS_LOGTAIL_CANDIDATES = [
    DEFAULT_LOGTAIL,
    r"C:\logtail-0.4.24-cli-release-windows-amd64\logtail.exe",
]
WSL_POWERSHELL = Path("/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe")
WSL_LOGTAIL_BRIDGE_SCRIPT = Path(__file__).with_name("run_logtail.ps1")
DEFAULT_INDEX = "up5_prod"
DEFAULT_RESOLVE_INDEX = "up5_prod_up1_game_server"
DEFAULT_OUTPUT_ROOT = Path("archive-changes")
LOGTAIL_TIME_FORMAT = "%Y.%m.%d-%H:%M:%S"
CSV_FIELDS = [
    "aid",
    "nickname",
    "query_from",
    "query_to",
    "log_time",
    "game_server",
    "game_play_id",
    "timestamp",
    "archive_diff",
    "raw_log",
]
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")

SUMMARY_FIELDS = [
    "aid",
    "nickname",
    "window_from",
    "window_to",
    "mode",
    "exit_code",
    "raw_line_count",
    "matched_log_count",
    "duplicate_count",
    "hit_limit",
    "retry_of",
    "error",
]


@dataclass
class Player:
    input_name: str
    nickname: str
    discriminator: str
    aid: str | None = None
    resolved_role_name: str = ""


@dataclass
class QueryResult:
    output: str
    exit_code: int | None
    error: str = ""


@dataclass
class WindowResult:
    rows: list[dict[str, str]]
    raw_lines: list[str]
    summary: dict[str, object]
    failed: bool = False


def parse_player(text: str) -> Player:
    value = text.strip()
    if not value:
        raise ValueError("empty player name")
    if "#" in value:
        nickname, discriminator = value.rsplit("#", 1)
        return Player(input_name=value, nickname=nickname.strip(), discriminator=discriminator.strip())
    return Player(input_name=value, nickname=value, discriminator="")


def safe_name(text: str) -> str:
    text = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", text).strip(" .")
    return text or "player"


def unique_path(path: Path) -> Path:
    """Return a non-existing sibling path without deleting or overwriting existing output."""
    if not path.exists():
        return path
    for index in range(2, 10_000):
        candidate = path.with_name(f"{path.stem}-{index}{path.suffix}")
        if not candidate.exists():
            return candidate
    raise RuntimeError(f"could not allocate unique output path for {path}")


def parse_time(value: str) -> datetime:
    try:
        return datetime.strptime(value, LOGTAIL_TIME_FORMAT)
    except ValueError as exc:
        raise ValueError(f"time must use YYYY.MM.DD-HH:mm:ss: {value!r}") from exc


def format_time(value: datetime) -> str:
    return value.strftime(LOGTAIL_TIME_FORMAT)


def iter_windows(from_time: str, to_time: str, hours: int) -> Iterable[tuple[str, str]]:
    start = parse_time(from_time)
    end = parse_time(to_time)
    if end <= start:
        raise ValueError("--to must be after --from")
    step = timedelta(hours=hours)
    cur = start
    while cur < end:
        nxt = min(cur + step, end)
        yield format_time(cur), format_time(nxt)
        cur = nxt


def is_wsl_environment() -> bool:
    release = platform.uname().release.lower()
    return bool(os.environ.get("WSL_INTEROP")) or "microsoft" in release or "wsl" in release


def windows_path_to_wsl_path(value: str) -> Path | None:
    match = re.match(r"^([A-Za-z]):[\\/](.*)$", value)
    if not match:
        return None
    drive = match.group(1).lower()
    rest = match.group(2).replace("\\", "/")
    return Path("/mnt") / drive / rest


def wsl_path_to_windows_path(value: str) -> str | None:
    match = re.match(r"^/mnt/([A-Za-z])/(.*)$", value)
    if not match:
        return None
    drive = match.group(1).upper()
    rest = match.group(2).replace("/", "\\")
    return f"{drive}:\\{rest}"


def candidate_windows_logtail_paths(requested: str) -> list[str]:
    candidates = [requested]
    if requested == DEFAULT_LOGTAIL:
        candidates.extend(path for path in DEFAULT_WINDOWS_LOGTAIL_CANDIDATES if path not in candidates)
    return candidates


def find_windows_logtail_path(requested: str) -> str | None:
    for candidate in candidate_windows_logtail_paths(requested):
        wsl_path = windows_path_to_wsl_path(candidate)
        if wsl_path and wsl_path.exists():
            return candidate
    return None


def auto_windows_logtail_conf() -> str:
    for user_dir in Path("/mnt/c/Users").glob("*"):
        conf = user_dir / ".logtail.conf"
        if conf.exists():
            return wsl_path_to_windows_path(str(conf)) or ""
    return ""


def wsl_logtail_bridge_script() -> str:
    if not WSL_POWERSHELL.exists():
        raise SystemExit(f"powershell.exe not found at {WSL_POWERSHELL}; cannot run Windows logtail from WSL")
    if not WSL_LOGTAIL_BRIDGE_SCRIPT.exists():
        raise SystemExit(f"PowerShell logtail bridge not found: {WSL_LOGTAIL_BRIDGE_SCRIPT}")
    windows_script = wsl_path_to_windows_path(str(WSL_LOGTAIL_BRIDGE_SCRIPT))
    if not windows_script:
        raise SystemExit(
            "PowerShell logtail bridge must be under /mnt/<drive>/... so Windows can execute it"
        )
    return windows_script


def resolve_logtail_command(logtail: str, logtail_conf: str = "") -> list[str]:
    """Return argv prefix for logtail, including WSL Windows-exe interop when needed."""
    if is_wsl_environment():
        direct_path = Path(logtail)
        if direct_path.exists() and not str(logtail).lower().endswith(".exe"):
            return [logtail]

        windows_logtail = find_windows_logtail_path(logtail)
        if windows_logtail:
            command = [
                "/init",
                str(WSL_POWERSHELL),
                "-NoProfile",
                "-ExecutionPolicy",
                "Bypass",
                "-File",
                wsl_logtail_bridge_script(),
                windows_logtail,
            ]
            conf = logtail_conf or auto_windows_logtail_conf()
            if conf:
                command.extend(["--conf", conf])
            print("using Windows logtail through WSL /init PowerShell bridge", flush=True)
            if conf:
                print(f"using logtail conf: {conf}", flush=True)
            return command

        if direct_path.exists():
            return [logtail]

        mapped = windows_path_to_wsl_path(logtail)
        hint = f" (mapped WSL path checked: {mapped})" if mapped else ""
        raise SystemExit(f"logtail.exe not found: {logtail}{hint}")

    logtail_path = Path(logtail)
    if not logtail_path.exists():
        raise SystemExit(f"logtail.exe not found: {logtail}")
    command = [logtail]
    if logtail_conf:
        command.extend(["--conf", logtail_conf])
    return command


def run_logtail(
    logtail: Sequence[str],
    index: str,
    query: str,
    from_time: str,
    to_time: str | None,
    limit: int,
    timeout: int,
    *,
    scroll: bool = False,
    out_step: int | None = None,
    out_file: Path | None = None,
) -> QueryResult:
    args = [*logtail, "-s", query, "--index", index, "-f", from_time]
    if to_time:
        args.extend(["-t", to_time])
    args.extend(["--raw", "--hide-hostname"])
    if scroll:
        args.append("--scroll")
        if out_step:
            args.extend(["--out-step", str(out_step)])
        if out_file:
            args.extend(["--out-file", str(out_file)])
    else:
        args.extend(["--limit", str(limit)])

    try:
        cp = subprocess.run(
            args,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=timeout,
        )
        return QueryResult(output=cp.stdout or "", exit_code=cp.returncode)
    except subprocess.TimeoutExpired as exc:
        return QueryResult(output=exc.stdout or "", exit_code=None, error=f"timeout after {timeout}s")


def extract_json(line: str) -> dict | None:
    start = line.find("{")
    if start < 0:
        return None
    try:
        return json.loads(line[start:])
    except json.JSONDecodeError:
        return None


def extract_aids(lines: Iterable[str], required_nickname: str | None = None) -> list[tuple[str, str, str]]:
    """Return (aid, role_name, sample_line) tuples in first-seen order."""
    rows: list[tuple[str, str, str]] = []
    seen: set[str] = set()
    for line in lines:
        if required_nickname and required_nickname not in line:
            continue
        candidates: list[tuple[str, str]] = []
        for match in re.finditer(r"plat_aid:(\d+);nickname:([^:]+?)(?=:)", line):
            candidates.append((match.group(1), match.group(2)))
        for match in re.finditer(r"Aid\((\d+)\).*?Nickname\(([^)]*)\).*?NameTag\(([^)]*)\)", line):
            role = match.group(2)
            if match.group(3):
                role = f"{role}#{match.group(3)}"
            candidates.append((match.group(1), role))
        for match in re.finditer(r"(?<![\w])(?:\d+:)?(\d+)#([^#:\s]+)#(\d+)(?![\w])", line):
            candidates.append((match.group(1), f"{match.group(2)}#{match.group(3)}"))

        role_name = ""
        match = re.search(r'"role_name"\s*:\s*"([^"]*)"', line)
        if match:
            role_name = match.group(1)
        for pattern in (
            r'"aid"\s*:\s*"?(\d+)"?',
            r'"role_id"\s*:\s*"?(\d+)"?',
            r'"player_guid"\s*:\s*"?(\d+)"?',
            r"plat_aid:(\d+)",
        ):
            for match in re.finditer(pattern, line):
                candidates.append((match.group(1), role_name))

        for aid, role in candidates:
            if aid not in seen:
                seen.add(aid)
                rows.append((aid, role, line))
    return rows


def resolve_player(player: Player, args: argparse.Namespace) -> Player:
    if player.nickname.isdigit() and not player.discriminator:
        player.aid = player.nickname
        player.resolved_role_name = player.nickname
        return player

    exact = player.input_name if player.discriminator else player.nickname
    resolve_attempts: list[tuple[str, str, str | None, str | None]] = []

    # The game-server index contains StartGame/rank logs with plat_aid/nickname.
    for from_arg in args.resolve_recent:
        resolve_attempts.append((args.resolve_index, exact, from_arg, None))
        if player.discriminator:
            resolve_attempts.append((args.resolve_index, player.nickname, from_arg, player.nickname))

    # Fall back to caller range and archive index for older/simple logs.
    resolve_attempts.append((args.resolve_index, exact, args.from_time, args.to_time))
    if player.discriminator:
        resolve_attempts.append((args.resolve_index, player.nickname, args.from_time, args.to_time))
    resolve_attempts.append((args.index, exact, args.from_time, args.to_time))
    if player.discriminator:
        resolve_attempts.append((args.index, player.nickname, args.from_time, args.to_time))

    candidates: list[tuple[str, str, str]] = []
    for index, query, from_time, to_time in resolve_attempts:
        result = run_logtail(args.logtail, index, query, from_time, to_time, args.resolve_limit, args.resolve_timeout)
        if result.error:
            continue
        required = player.nickname if query == player.nickname else None
        candidates = extract_aids(result.output.splitlines(), required)
        if candidates:
            break

    if not candidates:
        raise RuntimeError(f"could not resolve aid for {player.input_name!r}")

    chosen = None
    exact_role = player.input_name if player.discriminator else player.nickname
    exact_markers = []
    if player.discriminator:
        exact_markers = [
            f"#{player.nickname}#{player.discriminator}",
            f"Nickname({player.nickname}), NameTag({player.discriminator})",
            f"nickname:{player.nickname}:NameTag({player.discriminator})",
        ]

    for aid, role, line in candidates:
        if role == exact_role:
            chosen = (aid, role, line)
            break
    if not chosen and player.discriminator:
        for aid, role, line in candidates:
            if role == player.nickname and any(marker in line for marker in exact_markers):
                chosen = (aid, exact_role, line)
                break
    if not chosen and not player.discriminator:
        for aid, role, line in candidates:
            if role == player.nickname:
                chosen = (aid, role, line)
                break
    if not chosen and player.discriminator:
        for aid, role, line in candidates:
            if role.endswith(f"#{player.discriminator}") and (role == exact_role or player.nickname in role):
                chosen = (aid, role, line)
                break
    if not chosen and player.discriminator:
        # Avoid resolving name#tag to an arbitrary player whose nickname merely contains the name.
        candidates_preview = "; ".join(f"{aid}:{role}" for aid, role, _ in candidates[:8])
        raise RuntimeError(f"could not unambiguously resolve aid for {player.input_name!r}; candidates: {candidates_preview}")
    if not chosen:
        chosen = candidates[0]

    player.aid, role, _ = chosen
    player.resolved_role_name = role.split("#", 1)[0] if role else player.nickname
    return player


def log_time_from_line(line: str, timestamp: str) -> str:
    match = re.search(r"\[(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}) \+0800\]", line)
    if match:
        return match.group(1)
    return timestamp


def parse_archive_output(
    output: str,
    player: Player,
    args: argparse.Namespace,
    window_from: str,
    window_to: str,
    seen: set[str],
) -> tuple[list[dict[str, str]], list[str], int]:
    assert player.aid
    nickname = player.resolved_role_name or player.nickname
    rows: list[dict[str, str]] = []
    raw_lines: list[str] = []
    duplicate_count = 0
    for line in output.splitlines():
        if not line.strip() or "MapArchiveUpload" not in line or "archive_diff" not in line:
            continue
        if player.aid not in line:
            continue
        obj = extract_json(line) or {}
        if str(obj.get("aid", "")) != player.aid:
            continue
        if args.map_id and str(obj.get("game_play_id", "")) != args.map_id:
            continue
        raw_lines.append(line)
        if line in seen:
            duplicate_count += 1
            continue
        seen.add(line)
        timestamp = str(obj.get("timestamp", ""))
        rows.append(
            {
                "aid": player.aid,
                "nickname": nickname,
                "query_from": window_from,
                "query_to": window_to,
                "log_time": log_time_from_line(line, timestamp),
                "game_server": str(obj.get("game_server", "")),
                "game_play_id": str(obj.get("game_play_id", "")),
                "timestamp": timestamp,
                "archive_diff": str(obj.get("archive_diff", "")),
                "raw_log": line,
            }
        )
    return rows, raw_lines, duplicate_count


def build_archive_query(player: Player, map_id: str) -> str:
    assert player.aid
    parts = [player.aid]
    if map_id:
        parts.append(map_id)
    parts.extend(["MapArchiveUpload", "archive_diff"])
    return " && ".join(parts)


def query_window(
    player: Player,
    args: argparse.Namespace,
    window_from: str,
    window_to: str,
    seen: set[str],
    *,
    mode: str,
    retry_of: str = "",
    raw_file: Path | None = None,
) -> WindowResult:
    assert player.aid
    nickname = player.resolved_role_name or player.nickname
    query = build_archive_query(player, args.map_id)
    output = ""
    result: QueryResult

    if mode == "scroll":
        assert raw_file is not None
        result = run_logtail(
            args.logtail,
            args.index,
            query,
            window_from,
            window_to,
            args.log_limit,
            args.timeout,
            scroll=True,
            out_step=args.scroll_out_step_hours,
            out_file=raw_file,
        )
        if raw_file.exists():
            output = raw_file.read_text(encoding="utf-8", errors="replace")
        if not output:
            output = result.output
    else:
        result = run_logtail(args.logtail, args.index, query, window_from, window_to, args.log_limit, args.timeout)
        output = result.output

    rows, raw_lines, duplicates = parse_archive_output(output, player, args, window_from, window_to, seen)
    output_lines = [line for line in output.splitlines() if line.strip()]
    hit_limit = (mode != "scroll") and len(output_lines) >= args.log_limit
    error = result.error
    if result.exit_code not in (0, None):
        error = error or output[:500].replace("\n", " ")
    if "EsTailer search shard failed" in result.output:
        error = (error + "; " if error else "") + "EsTailer search shard failed"
    if "max split count exceeded" in result.output:
        error = (error + "; " if error else "") + "max split count exceeded"

    summary = {
        "aid": player.aid,
        "nickname": nickname,
        "window_from": window_from,
        "window_to": window_to,
        "mode": mode,
        "exit_code": "" if result.exit_code is None else result.exit_code,
        "raw_line_count": len(output_lines),
        "matched_log_count": len(rows),
        "duplicate_count": duplicates,
        "hit_limit": hit_limit,
        "retry_of": retry_of,
        "error": error,
    }
    failed = bool(error) or hit_limit
    return WindowResult(rows=rows, raw_lines=raw_lines, summary=summary, failed=failed)


def fetch_archive_changes(player: Player, args: argparse.Namespace, out_dir: Path) -> dict[str, object]:
    assert player.aid
    nickname = player.resolved_role_name or player.nickname
    prefix = f"{player.aid}_{safe_name(nickname)}"
    run_token = datetime.now().strftime("%Y%m%d%H%M%S%f")
    player_dir = out_dir / "raw_parts" / prefix / run_token
    player_dir.mkdir(parents=True, exist_ok=True)

    seen: set[str] = set()
    rows: list[dict[str, str]] = []
    raw_lines: list[str] = []
    summaries: list[dict[str, object]] = []

    primary_hours = args.primary_window_hours
    use_scroll = args.use_scroll or (parse_time(args.to_time) - parse_time(args.from_time) > timedelta(hours=args.primary_window_hours))
    mode = "scroll" if use_scroll else "normal"

    for idx, (window_from, window_to) in enumerate(iter_windows(args.from_time, args.to_time, primary_hours)):
        raw_file = player_dir / f"primary_{idx:03d}_{window_from.replace(':', '').replace('.', '').replace('-', '_')}.log"
        print(f"query {player.input_name} {window_from} -> {window_to} ({mode})", flush=True)
        result = query_window(player, args, window_from, window_to, seen, mode=mode, raw_file=raw_file)
        rows.extend(result.rows)
        raw_lines.extend(result.raw_lines)
        summaries.append(result.summary)
        print(
            f"  matched={result.summary['matched_log_count']} raw={result.summary['raw_line_count']} "
            f"hit_limit={result.summary['hit_limit']} error={result.summary['error']}",
            flush=True,
        )

        if result.failed and args.retry_failed:
            for retry_idx, (retry_from, retry_to) in enumerate(iter_windows(window_from, window_to, args.retry_window_hours)):
                retry_mode = "normal"
                print(f"  retry {retry_from} -> {retry_to} ({retry_mode})", flush=True)
                retry_result = query_window(
                    player,
                    args,
                    retry_from,
                    retry_to,
                    seen,
                    mode=retry_mode,
                    retry_of=f"{window_from}->{window_to}",
                )
                rows.extend(retry_result.rows)
                raw_lines.extend(retry_result.raw_lines)
                summaries.append(retry_result.summary)
                print(
                    f"    matched={retry_result.summary['matched_log_count']} raw={retry_result.summary['raw_line_count']} "
                    f"hit_limit={retry_result.summary['hit_limit']} error={retry_result.summary['error']}",
                    flush=True,
                )

    rows.sort(key=lambda row: (row["log_time"], row["timestamp"], row["raw_log"]))
    csv_path = unique_path(out_dir / f"{prefix}_archive_changes.csv")
    with csv_path.open("w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=CSV_FIELDS)
        writer.writeheader()
        writer.writerows(rows)

    summary_path = unique_path(out_dir / f"{prefix}_fetch_summary.csv")
    with summary_path.open("w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=SUMMARY_FIELDS)
        writer.writeheader()
        writer.writerows(summaries)

    raw_path = ""
    if args.write_raw:
        raw_file = unique_path(out_dir / f"{prefix}_raw.log")
        with raw_file.open("w", encoding="utf-8") as f:
            for line in raw_lines:
                f.write(line + "\n")
        raw_path = str(raw_file)

    return {
        "aid": player.aid,
        "nickname": nickname,
        "input_name": player.input_name,
        "matched_log_count": len(rows),
        "csv_file": str(csv_path),
        "summary_file": str(summary_path),
        "raw_file": raw_path,
        "search": build_archive_query(player, args.map_id),
        "problem_windows": sum(1 for item in summaries if item.get("error") or item.get("hit_limit")),
        "first_log_time": rows[0]["log_time"] if rows else "",
        "last_log_time": rows[-1]["log_time"] if rows else "",
    }


def write_mapping(players: list[Player], out_dir: Path) -> Path:
    path = unique_path(out_dir / "aid_nickname_mapping.csv")
    with path.open("w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=["aid", "nickname", "input_name"])
        writer.writeheader()
        for player in players:
            writer.writerow(
                {
                    "aid": player.aid or "",
                    "nickname": player.resolved_role_name or player.nickname,
                    "input_name": player.input_name,
                }
            )
    return path


def write_fetch_summary(results: list[dict[str, object]], out_dir: Path) -> Path:
    path = unique_path(out_dir / "fetch_summary.csv")
    fields = [
        "aid",
        "nickname",
        "input_name",
        "matched_log_count",
        "first_log_time",
        "last_log_time",
        "problem_windows",
        "csv_file",
        "summary_file",
        "raw_file",
        "search",
    ]
    with path.open("w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fields)
        writer.writeheader()
        writer.writerows(results)
    return path


def write_zip(out_dir: Path, results: list[dict[str, object]], mapping: Path, fetch_summary: Path) -> Path:
    zip_path = unique_path(out_dir / f"{out_dir.name}.zip")
    with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        zf.write(mapping, arcname=mapping.name)
        zf.write(fetch_summary, arcname=fetch_summary.name)
        for result in results:
            for key in ("csv_file", "summary_file", "raw_file"):
                value = result.get(key)
                if value:
                    path = Path(str(value))
                    if path.exists():
                        zf.write(path, arcname=path.name)
    return zip_path


def normalize_recipients(values: Sequence[str]) -> list[str]:
    recipients: list[str] = []
    for value in values:
        for item in re.split(r"[,;]", value):
            recipient = item.strip()
            if not recipient:
                continue
            if not EMAIL_RE.match(recipient):
                raise ValueError(f"invalid email recipient: {recipient!r}")
            recipients.append(recipient)
    if not recipients:
        raise ValueError("--email-to requires at least one recipient")
    return recipients


def default_mutt_path() -> str:
    local = Path(".local-tools/mail/mutt")
    if local.exists():
        return str(local)
    found = shutil.which("mutt")
    return found or "mutt"


def build_email_subject(args: argparse.Namespace, out_dir: Path) -> str:
    if args.email_subject:
        return args.email_subject
    map_part = f"地图{args.map_id}"
    return f"{map_part}存档变动日志（{args.from_time}至{args.to_time}）"


def build_email_body(args: argparse.Namespace, results: list[dict[str, object]], zip_path: Path) -> str:
    lines = [
        "你好，",
        "",
        "附件是本次导出的存档变动日志压缩包。",
        "",
        f"地图ID：{args.map_id}",
        f"时间范围：{args.from_time} 至 {args.to_time}（结束时间不含）",
        f"附件：{zip_path.name}",
        "",
        "玩家汇总：",
    ]
    for result in results:
        lines.append(
            f"- {result.get('input_name', '')}: aid={result.get('aid', '')}, "
            f"日志数={result.get('matched_log_count', '')}, "
            f"首条={result.get('first_log_time', '') or '无'}, "
            f"末条={result.get('last_log_time', '') or '无'}, "
            f"异常窗口={result.get('problem_windows', '')}"
        )
    lines.extend(["", "请查收。", ""])
    return "\n".join(lines)


def send_zip_email(args: argparse.Namespace, results: list[dict[str, object]], out_dir: Path, zip_path: Path) -> list[str]:
    recipients = normalize_recipients(args.email_to)
    mutt = args.mail_mutt or default_mutt_path()
    command = [mutt]
    muttrc = args.mail_muttrc or ".local-tools/mail/config/muttrc"
    if Path(muttrc).exists():
        command.extend(["-F", muttrc])
    elif args.mail_muttrc:
        raise FileNotFoundError(f"mail muttrc not found: {muttrc}")
    command.extend(["-s", build_email_subject(args, out_dir), "-a", str(zip_path), "--", *recipients])
    body = build_email_body(args, results, zip_path)
    cp = subprocess.run(
        command,
        input=body,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=args.email_timeout,
    )
    if cp.returncode != 0:
        output = (cp.stdout or "").strip()
        raise RuntimeError(f"email send failed with exit code {cp.returncode}: {output}")
    return recipients


def default_output_dir(args: argparse.Namespace, players: list[Player]) -> Path:
    if args.out_dir:
        return Path(args.out_dir)

    date_token = re.sub(r"\D", "", args.from_time)[:8] or "logs"
    map_token = f"-{args.map_id}" if args.map_id else ""
    return DEFAULT_OUTPUT_ROOT / f"archive-change{map_token}-{date_token}-{len(players)}players"


def main() -> int:
    parser = argparse.ArgumentParser(description="Fetch per-player archive change logs from logtail.")
    parser.add_argument("--players", nargs="+", required=True, help="Player nicknames, optionally with #suffix, or raw aid values.")
    parser.add_argument("--from", dest="from_time", required=True, help="Start time, e.g. 2026.05.14-00:00:00")
    parser.add_argument("--to", dest="to_time", required=True, help="Exclusive end time, e.g. 2026.05.15-00:00:00")
    parser.add_argument(
        "--out-dir",
        default="",
        help="Output directory. Defaults to archive-changes/archive-change-<date>-<n>players.",
    )
    parser.add_argument("--map-id", required=True, help="Required game_play_id/map id filter, e.g. 204521.")
    parser.add_argument("--logtail", default=DEFAULT_LOGTAIL)
    parser.add_argument("--logtail-conf", default="", help="Optional logtail config path. In WSL this auto-discovers C:\\Users\\*\\.logtail.conf when omitted.")
    parser.add_argument("--index", default=DEFAULT_INDEX)
    parser.add_argument("--resolve-index", default=DEFAULT_RESOLVE_INDEX)
    parser.add_argument("--resolve-recent", nargs="*", default=["-3d", "-12h"], help="Recent relative windows for nickname resolution.")
    parser.add_argument("--resolve-limit", type=int, default=50)
    parser.add_argument("--log-limit", type=int, default=10000)
    parser.add_argument("--timeout", type=int, default=240)
    parser.add_argument("--resolve-timeout", type=int, default=90)
    parser.add_argument("--primary-window-hours", type=int, default=48, help="Primary query window; keep <= 240h due logtail 10-day limit.")
    parser.add_argument("--retry-window-hours", type=int, default=6, help="Retry window for timeouts, shard failures, and hit-limit windows.")
    parser.add_argument("--scroll-out-step-hours", type=int, default=6, help="Scroll split step. Ensure primary_window_hours / step <= 10.")
    parser.add_argument("--use-scroll", action=argparse.BooleanOptionalAction, default=False, help="Force scroll export for primary windows; long ranges use scroll automatically.")
    parser.add_argument("--retry-failed", action=argparse.BooleanOptionalAction, default=True)
    parser.add_argument("--write-raw", action=argparse.BooleanOptionalAction, default=False, help="Write deduplicated raw log file per player.")
    parser.add_argument("--zip", action=argparse.BooleanOptionalAction, default=True, help="Zip final deliverables.")
    parser.add_argument("--email-to", nargs="+", default=[], help="Email generated zip to explicit recipient address(es) after export. Accepts spaces, commas, or semicolons.")
    parser.add_argument("--email-subject", default="", help="Optional subject for --email-to.")
    parser.add_argument("--mail-mutt", default="", help="Optional mutt executable path. Defaults to .local-tools/mail/mutt, then PATH mutt.")
    parser.add_argument("--mail-muttrc", default="", help="Optional mutt config path. Defaults to .local-tools/mail/config/muttrc when present.")
    parser.add_argument("--email-timeout", type=int, default=120, help="Seconds to wait for mutt/msmtp to send email.")
    args = parser.parse_args()

    if args.primary_window_hours > 239:
        raise SystemExit("--primary-window-hours must stay below logtail's 10-day limit")
    if args.use_scroll and args.primary_window_hours // args.scroll_out_step_hours > 10:
        raise SystemExit("scroll split count would exceed 10; increase --scroll-out-step-hours or reduce --primary-window-hours")
    if args.email_to and not args.zip:
        raise SystemExit("--email-to requires zip output; remove --no-zip or omit --email-to")
    if args.email_to:
        try:
            args.email_to = normalize_recipients(args.email_to)
        except ValueError as exc:
            raise SystemExit(str(exc)) from exc

    args.logtail = resolve_logtail_command(args.logtail, args.logtail_conf)

    parse_time(args.from_time)
    parse_time(args.to_time)

    players = [parse_player(value) for value in args.players]
    out_dir = default_output_dir(args, players)
    out_dir.mkdir(parents=True, exist_ok=True)

    resolved: list[Player] = []
    results: list[dict[str, object]] = []
    for player in players:
        resolved_player = resolve_player(player, args)
        resolved.append(resolved_player)
        print(f"resolved {player.input_name} -> {resolved_player.aid} ({resolved_player.resolved_role_name})", flush=True)
        result = fetch_archive_changes(resolved_player, args, out_dir)
        results.append(result)
        warning = "" if result["problem_windows"] == 0 else f"; problem_windows={result['problem_windows']} (see summary)"
        print(
            f"fetched {result['matched_log_count']} logs -> {result['csv_file']} "
            f"first={result['first_log_time']} last={result['last_log_time']}{warning}",
            flush=True,
        )

    mapping = write_mapping(resolved, out_dir)
    fetch_summary = write_fetch_summary(results, out_dir)
    print(f"mapping -> {mapping}")
    print(f"summary -> {fetch_summary}")
    zip_path: Path | None = None
    if args.zip:
        zip_path = write_zip(out_dir, results, mapping, fetch_summary)
        print(f"zip -> {zip_path}")
    if args.email_to:
        assert zip_path is not None
        recipients = send_zip_email(args, results, out_dir, zip_path)
        print(f"email -> {', '.join(recipients)}")
    print(f"output_dir -> {out_dir.resolve()}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
