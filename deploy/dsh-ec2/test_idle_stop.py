"""Focused tests for the EC2 idle-stop controller; all power operations are mocked."""

from __future__ import annotations

import json
import os
import subprocess
import tempfile
import time
import unittest
from pathlib import Path


SCRIPT = Path(__file__).with_name("idle-stop.sh")


class IdleStopControllerTest(unittest.TestCase):
    def run_controller(self, state: dict[str, int | bool] | None, *, dry_run: bool = False, hold: bool = False) -> tuple[int, str]:
        with tempfile.TemporaryDirectory(prefix="dsh-idle-stop-test-") as root:
            root_path = Path(root)
            bin_path = root_path / "bin"
            bin_path.mkdir()
            calls = root_path / "calls"
            systemctl = bin_path / "systemctl"
            systemctl.write_text(
                "#!/bin/sh\n"
                f"if [ \"$1\" = is-active ]; then exit 0; fi\n"
                f"printf '%s\\n' \"$*\" >> {calls}\n",
                encoding="utf-8",
            )
            systemctl.chmod(0o755)
            flock = bin_path / "flock"
            flock.write_text("#!/bin/sh\nexit 0\n", encoding="utf-8")
            flock.chmod(0o755)
            state_path = root_path / "state.json"
            if state is not None:
                state_path.write_text(json.dumps(state) + "\n", encoding="utf-8")
            hold_path = root_path / "hold"
            if hold:
                hold_path.touch()
            env = {
                **os.environ,
                "PATH": f"{bin_path}:{os.environ.get('PATH', '')}",
                "DSH_IDLE_STATE_FILE": str(state_path),
                "DSH_IDLE_STOP_HOLD_FILE": str(hold_path),
                "DSH_IDLE_DEPLOY_LOCK_FILE": str(root_path / "deploy.lock"),
                "DSH_IDLE_STOP_DRY_RUN": "1" if dry_run else "0",
            }
            result = subprocess.run(
                ["bash", str(SCRIPT)],
                env=env,
                capture_output=True,
                text=True,
                check=False,
            )
            return result.returncode, (calls.read_text(encoding="utf-8") if calls.exists() else "")

    @staticmethod
    def state(*, last_activity_at: int, active_jobs: int = 0, capabilities_ready: bool = True) -> dict[str, int | bool]:
        return {
            "schemaVersion": 2,
            "capabilitiesReady": capabilities_ready,
            "observedAt": int(time.time() * 1000),
            "lastActivityAt": last_activity_at,
            "activeHttpRequests": 0,
            "activeWebSockets": 0,
            "activeJobs": active_jobs,
            "activePtys": 0,
        }

    def test_missing_and_stale_state_fail_closed(self) -> None:
        result, calls = self.run_controller(None)
        self.assertEqual(result, 0)
        self.assertEqual(calls, "")

        stale = self.state(last_activity_at=int(time.time() * 1000) - 1_805_000)
        stale["observedAt"] -= 601_000
        result, calls = self.run_controller(stale)
        self.assertEqual(result, 0)
        self.assertEqual(calls, "")

    def test_live_job_blocks_shutdown(self) -> None:
        state = self.state(last_activity_at=int(time.time() * 1000) - 1_805_000, active_jobs=1)
        result, calls = self.run_controller(state)
        self.assertEqual(result, 0)
        self.assertEqual(calls, "")
        self.assertNotIn("poweroff", calls)

    def test_incomplete_activity_capabilities_block_shutdown(self) -> None:
        state = self.state(last_activity_at=int(time.time() * 1000) - 1_805_000, capabilities_ready=False)
        result, calls = self.run_controller(state)
        self.assertEqual(result, 0)
        self.assertEqual(calls, "")

    def test_hold_and_dry_run_are_non_destructive(self) -> None:
        state = self.state(last_activity_at=int(time.time() * 1000) - 1_805_000)
        result, calls = self.run_controller(state, hold=True)
        self.assertEqual(result, 0)
        self.assertEqual(calls, "")

        result, calls = self.run_controller(state, dry_run=True)
        self.assertEqual(result, 0)
        self.assertNotIn("poweroff", calls)

    def test_verified_idle_path_stops_service_then_powers_off(self) -> None:
        state = self.state(last_activity_at=int(time.time() * 1000) - 1_805_000)
        result, calls = self.run_controller(state)
        self.assertEqual(result, 0)
        self.assertIn("stop dsh.service", calls)
        self.assertIn("poweroff", calls)


if __name__ == "__main__":
    unittest.main()
