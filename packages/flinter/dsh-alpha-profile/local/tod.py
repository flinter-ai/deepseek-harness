#!/usr/bin/env python3
"""Update the local alpha profile's fresh-session default model.

This is deliberately a settings-layer adapter, not a provider catalog. The
alpha profile owns endpoints, credentials, and model capacities; this script
only preserves the legacy time-of-day default-model seam for an isolated
``DSH_HOME``.

UTC policy:
  16:00-24:00 -> ark-agent-plan / ark-code-latest
  otherwise   -> modelflare / gpt-5.6-sol

Existing sessions keep their recorded route. The DSH settings watcher applies
the changed default to fresh sessions only.
"""

import argparse
import datetime as dt
import os
import pathlib
import re
import tempfile


ARK = ("ark-agent-plan", "ark-code-latest", "high")
MODELFLARE = ("modelflare", "gpt-5.6-sol", "high")
BLOCK_RE = re.compile(r"^agent-default-model:\n(?:[ \t].*\n|\n)*", re.MULTILINE)


def pick(hour: int) -> tuple[str, str, str]:
    """Return the provider/model/reasoning route for one UTC hour."""
    if not 0 <= hour <= 23:
        raise ValueError(f"hour must be between 0 and 23, got {hour}")
    return ARK if 16 <= hour < 24 else MODELFLARE


def block(choice: tuple[str, str, str]) -> str:
    provider, model, effort = choice
    return (
        "agent-default-model:\n"
        f"  model: {model}\n"
        f"  provider: {provider}\n"
        f"  reasoningEffort: {effort}\n"
    )


def rewrite(text: str, choice: tuple[str, str, str]) -> str:
    """Replace only the top-level default-model block; fail closed if absent."""
    found = BLOCK_RE.search(text)
    if found is None:
        raise ValueError("settings file has no agent-default-model block; refusing to write")
    return text[: found.start()] + block(choice) + text[found.end() :]


def apply(settings: pathlib.Path, choice: tuple[str, str, str]) -> bool:
    """Atomically update ``settings`` and keep the temporary file private."""
    text = settings.read_text()
    updated = rewrite(text, choice)
    if updated == text:
        return False

    fd, temporary = tempfile.mkstemp(
        prefix=f".{settings.name}.", suffix=".tod-tmp", dir=settings.parent
    )
    try:
        os.fchmod(fd, 0o600)
        with os.fdopen(fd, "w") as stream:
            stream.write(updated)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, settings)
    except BaseException:
        try:
            os.unlink(temporary)
        except FileNotFoundError:
            pass
        raise
    return True


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--home",
        type=pathlib.Path,
        default=pathlib.Path(os.environ.get("DSH_HOME", pathlib.Path.home() / ".dsh")),
        help="isolated DSH home; defaults to DSH_HOME or ~/.dsh",
    )
    parser.add_argument(
        "--hour",
        type=int,
        default=None,
        help="UTC hour for a deterministic probe; defaults to TOD_HOUR or the current hour",
    )
    parser.add_argument("--selftest", action="store_true")
    return parser.parse_args()


def selftest() -> None:
    assert {hour for hour in range(24) if pick(hour) == ARK} == set(range(16, 24))
    assert {hour for hour in range(24) if pick(hour) == MODELFLARE} == set(range(16))
    for choice in (MODELFLARE, ARK):
        assert BLOCK_RE.match(block(choice) + "agent-presets:\n").group(0) == block(choice)
    print("alpha tod: selftest ok (24/24 UTC hours covered)")


def main() -> None:
    args = parse_args()
    if args.selftest:
        selftest()
        return
    hour = args.hour
    if hour is None:
        raw_hour = os.environ.get("TOD_HOUR")
        hour = int(raw_hour) if raw_hour is not None else dt.datetime.now(dt.timezone.utc).hour
    settings = args.home / "settings.yaml"
    changed = apply(settings, pick(hour))
    provider, model, _ = pick(hour)
    suffix = "" if changed else " (already set)"
    print(f"alpha tod: {hour:02d}:00Z -> {provider}/{model}{suffix}")


if __name__ == "__main__":
    main()
