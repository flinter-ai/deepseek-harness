#!/usr/bin/env python3
"""Converge the live ARK model compatibility flag without rewriting YAML."""

from __future__ import annotations

import os
import pathlib
import re
import sys
import tempfile


PROVIDER = re.compile(r"^    ark-agent-plan:\s*$")
NEXT_PROVIDER = re.compile(r"^    [A-Za-z0-9_-]+:\s*$")
MODEL = re.compile(r"^        - id: ark-code-latest\s*$")
NEXT_MODEL = re.compile(r"^        - id: \S+\s*$")
COMPAT = re.compile(r"^          compat:\s*$")
DEVELOPER_ROLE = re.compile(r"^(            supportsDeveloperRole:)\s*(\S+)\s*$")


def converge(text: str) -> tuple[str, bool]:
    """Return settings text with ARK's developer-role compatibility disabled."""
    lines = text.splitlines(keepends=True)
    provider_indexes = [
        index for index, line in enumerate(lines)
        if PROVIDER.match(line.rstrip("\n"))
    ]
    if len(provider_indexes) != 1:
        raise ValueError("expected exactly one ark-agent-plan provider")

    provider_start = provider_indexes[0]
    provider_end = next(
        (
            index for index in range(provider_start + 1, len(lines))
            if NEXT_PROVIDER.match(lines[index].rstrip("\n"))
        ),
        len(lines),
    )
    model_indexes = [
        index for index in range(provider_start + 1, provider_end)
        if MODEL.match(lines[index].rstrip("\n"))
    ]
    if len(model_indexes) != 1:
        raise ValueError("expected exactly one ark-code-latest model under ark-agent-plan")

    model_start = model_indexes[0]
    model_end = next(
        (
            index for index in range(model_start + 1, provider_end)
            if NEXT_MODEL.match(lines[index].rstrip("\n"))
        ),
        provider_end,
    )
    compat_indexes = [
        index for index in range(model_start + 1, model_end)
        if COMPAT.match(lines[index].rstrip("\n"))
    ]
    if len(compat_indexes) > 1:
        raise ValueError("ark-code-latest has more than one compat block")

    if not compat_indexes:
        lines[model_start + 1:model_start + 1] = [
            "          compat:\n",
            "            supportsDeveloperRole: false\n",
        ]
        return "".join(lines), True

    compat_start = compat_indexes[0]
    compat_end = next(
        (
            index for index in range(compat_start + 1, model_end)
            if len(lines[index]) - len(lines[index].lstrip(" ")) <= 10 and lines[index].strip()
        ),
        model_end,
    )
    role_indexes = [
        index for index in range(compat_start + 1, compat_end)
        if DEVELOPER_ROLE.match(lines[index].rstrip("\n"))
    ]
    if len(role_indexes) > 1:
        raise ValueError("ark-code-latest has more than one supportsDeveloperRole setting")
    if not role_indexes:
        lines[compat_start + 1:compat_start + 1] = ["            supportsDeveloperRole: false\n"]
        return "".join(lines), True

    role_index = role_indexes[0]
    match = DEVELOPER_ROLE.match(lines[role_index].rstrip("\n"))
    assert match is not None
    if match.group(2) == "false":
        return text, False
    if match.group(2) != "true":
        raise ValueError("supportsDeveloperRole must be true or false")
    lines[role_index] = f"{match.group(1)} false\n"
    return "".join(lines), True


def atomic_write(path: pathlib.Path, content: str) -> None:
    """Replace one settings file while preserving owner and mode."""
    metadata = path.stat()
    descriptor, temporary = tempfile.mkstemp(
        prefix=f".{path.name}.", suffix=".compat", dir=path.parent
    )
    try:
        os.fchmod(descriptor, metadata.st_mode & 0o777)
        os.fchown(descriptor, metadata.st_uid, metadata.st_gid)
        with os.fdopen(descriptor, "w") as stream:
            stream.write(content)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    except BaseException:
        try:
            os.close(descriptor)
        except OSError:
            pass
        try:
            os.unlink(temporary)
        except FileNotFoundError:
            pass
        raise


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit(f"usage: {sys.argv[0]} <settings.yaml>")
    path = pathlib.Path(sys.argv[1])
    updated, changed = converge(path.read_text())
    if changed:
        atomic_write(path, updated)
    print(f"ark-model-compat={'migrated' if changed else 'already-current'}")


if __name__ == "__main__":
    main()
