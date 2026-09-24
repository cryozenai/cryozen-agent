"""release.py changelog attribution: maintainer commits are not credited as contributors.

Commits authored with the organisation's noreply address resolve to the maintainer
handle; the changelog must not tag each bullet with it or list it under Contributors,
while external authors keep their credit.
"""

from __future__ import annotations

import importlib.util
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[2] / "scripts" / "release.py"


def _load():
    spec = importlib.util.spec_from_file_location("release_changelog_authors", SCRIPT)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


release = _load()


def _commit(sha: str, subject: str, name: str, email: str) -> dict:
    return {
        "sha": sha,
        "short_sha": sha[:8],
        "author_name": name,
        "author_email": email,
        "subject": subject,
        "category": release.categorize_commit(subject),
        "github_author": release.resolve_author(name, email),
        "coauthors": [],
    }


def test_maintainer_commits_are_not_credited_but_external_authors_are():
    commits = [
        _commit(
            "a" * 40,
            "fix: maintainer change",
            "Cryozen",
            "cryozenai@users.noreply.github.com",
        ),
        _commit(
            "b" * 40,
            "fix: outside change",
            "Someone",
            "12345+outsider@users.noreply.github.com",
        ),
    ]

    changelog = release.generate_changelog(commits, "v2026.1.1", "0.1.0")

    maintainer = release.resolve_author("Cryozen", "cryozenai@users.noreply.github.com")
    assert maintainer not in changelog
    assert "- @outsider (1 commit)" in changelog
    assert any(
        line.startswith("- outside change") and line.endswith("— @outsider")
        for line in changelog.splitlines()
    )
