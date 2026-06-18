import argparse
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import fetch_archive_changes as subject


class DefaultOutputDirTest(unittest.TestCase):
    def test_defaults_under_archive_changes_without_map_id(self) -> None:
        args = argparse.Namespace(
            out_dir="",
            from_time="2026.05.19-00:00:00",
            map_id="",
        )
        players = [subject.parse_player("张凌赫#7315")]

        self.assertEqual(
            subject.default_output_dir(args, players),
            Path("archive-changes") / "archive-change-20260519-1players",
        )

    def test_defaults_under_archive_changes_with_map_id(self) -> None:
        args = argparse.Namespace(
            out_dir="",
            from_time="2026.05.19-00:00:00",
            map_id="204521",
        )
        players = [
            subject.parse_player("张凌赫#7315"),
            subject.parse_player("给你娃一锤子#8154"),
        ]

        self.assertEqual(
            subject.default_output_dir(args, players),
            Path("archive-changes") / "archive-change-204521-20260519-2players",
        )

    def test_explicit_out_dir_is_not_rewritten(self) -> None:
        args = argparse.Namespace(
            out_dir=str(Path(".") / "custom-output"),
            from_time="2026.05.19-00:00:00",
            map_id="204521",
        )
        players = [subject.parse_player("张凌赫#7315")]

        self.assertEqual(subject.default_output_dir(args, players), Path(".") / "custom-output")


class LogtailResolutionTest(unittest.TestCase):
    def test_windows_path_to_wsl_path(self) -> None:
        self.assertEqual(
            subject.windows_path_to_wsl_path(r"D:\logtail-0.4.24-cli-release-windows-amd64\logtail.exe"),
            Path("/mnt/d/logtail-0.4.24-cli-release-windows-amd64/logtail.exe"),
        )

    def test_wsl_path_to_windows_path(self) -> None:
        self.assertEqual(
            subject.wsl_path_to_windows_path("/mnt/c/Users/BAIM/.logtail.conf"),
            r"C:\Users\BAIM\.logtail.conf",
        )

    def test_wsl_resolves_windows_logtail_via_init_powershell_and_conf(self) -> None:
        with mock.patch.object(subject, "is_wsl_environment", return_value=True), \
             mock.patch.object(subject.Path, "exists", return_value=True):
            command = subject.resolve_logtail_command(
                r"D:\logtail-0.4.24-cli-release-windows-amd64\logtail.exe",
                r"C:\Users\BAIM\.logtail.conf",
            )

        self.assertEqual(
            command,
            [
                "/init",
                str(subject.WSL_POWERSHELL),
                "-NoProfile",
                "-ExecutionPolicy",
                "Bypass",
                "-File",
                subject.wsl_path_to_windows_path(str(subject.WSL_LOGTAIL_BRIDGE_SCRIPT)),
                r"D:\logtail-0.4.24-cli-release-windows-amd64\logtail.exe",
                "--conf",
                r"C:\Users\BAIM\.logtail.conf",
            ],
        )

    def test_wsl_default_falls_back_to_d_drive_candidate(self) -> None:
        def fake_exists(path: Path) -> bool:
            return str(path) in {
                str(subject.WSL_POWERSHELL),
                str(subject.WSL_LOGTAIL_BRIDGE_SCRIPT),
                "/mnt/d/logtail-0.4.24-cli-release-windows-amd64/logtail.exe",
            }

        with mock.patch.object(subject, "is_wsl_environment", return_value=True), \
             mock.patch.object(subject.Path, "exists", fake_exists), \
             mock.patch.object(subject, "auto_windows_logtail_conf", return_value=""):
            command = subject.resolve_logtail_command(subject.DEFAULT_LOGTAIL)

        self.assertEqual(
            command,
            [
                "/init",
                str(subject.WSL_POWERSHELL),
                "-NoProfile",
                "-ExecutionPolicy",
                "Bypass",
                "-File",
                subject.wsl_path_to_windows_path(str(subject.WSL_LOGTAIL_BRIDGE_SCRIPT)),
                r"D:\logtail-0.4.24-cli-release-windows-amd64\logtail.exe",
            ],
        )

    def test_non_wsl_keeps_native_logtail_with_optional_conf(self) -> None:
        with tempfile.NamedTemporaryFile() as logtail, \
             mock.patch.object(subject, "is_wsl_environment", return_value=False):
            command = subject.resolve_logtail_command(logtail.name, "/tmp/logtail.conf")

        self.assertEqual(command, [logtail.name, "--conf", "/tmp/logtail.conf"])


class OutputPreservationTest(unittest.TestCase):
    def test_write_zip_preserves_existing_zip_by_allocating_unique_name(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            out_dir = Path(temp_dir)
            existing_zip = out_dir / f"{out_dir.name}.zip"
            existing_zip.write_text("keep me", encoding="utf-8")
            mapping = out_dir / "aid_nickname_mapping.csv"
            summary = out_dir / "fetch_summary.csv"
            player_csv = out_dir / "30144230_player_archive_changes.csv"
            mapping.write_text("aid,nickname,input_name\n", encoding="utf-8")
            summary.write_text("aid,matched_log_count\n30144230,1\n", encoding="utf-8")
            player_csv.write_text("aid,nickname\n30144230,player\n", encoding="utf-8")

            zip_path = subject.write_zip(
                out_dir,
                [{"csv_file": str(player_csv), "summary_file": "", "raw_file": ""}],
                mapping,
                summary,
            )

            self.assertEqual(existing_zip.read_text(encoding="utf-8"), "keep me")
            self.assertEqual(zip_path, out_dir / f"{out_dir.name}-2.zip")
            self.assertTrue(zip_path.exists())

    def test_fetch_archive_changes_does_not_delete_existing_raw_parts(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            out_dir = Path(temp_dir)
            stale = out_dir / "raw_parts" / "30144230_player" / "stale.log"
            stale.parent.mkdir(parents=True)
            stale.write_text("keep me", encoding="utf-8")
            player = subject.Player(input_name="30144230", nickname="30144230", discriminator="", aid="30144230", resolved_role_name="player")
            args = argparse.Namespace(
                from_time="2026.06.09-00:00:00",
                to_time="2026.06.09-01:00:00",
                primary_window_hours=1,
                use_scroll=False,
                retry_failed=False,
                retry_window_hours=1,
                write_raw=False,
                map_id="204521",
            )

            def fake_query_window(player, args, window_from, window_to, seen, *, mode, retry_of="", raw_file=None):
                return subject.WindowResult(
                    rows=[],
                    raw_lines=[],
                    summary={
                        "aid": player.aid,
                        "nickname": player.resolved_role_name,
                        "window_from": window_from,
                        "window_to": window_to,
                        "mode": mode,
                        "exit_code": 0,
                        "raw_line_count": 0,
                        "matched_log_count": 0,
                        "duplicate_count": 0,
                        "hit_limit": False,
                        "retry_of": retry_of,
                        "error": "",
                    },
                    failed=False,
                )

            with mock.patch.object(subject, "query_window", side_effect=fake_query_window):
                result = subject.fetch_archive_changes(player, args, out_dir)

            self.assertEqual(stale.read_text(encoding="utf-8"), "keep me")
            self.assertTrue(Path(str(result["csv_file"])).exists())
            self.assertTrue(Path(str(result["summary_file"])).exists())


if __name__ == "__main__":
    unittest.main()
