"""Similarity corpus providers.

FolderCorpus is the folder-based corpus: peers come from the
problem's submissions folder, plus corpus/web and corpus/llm.
"""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Literal, Protocol

from .hashing import sha256
from .textfmt import WS_RE, text_sort_key

CorpusKind = Literal["peer", "web", "llm"]


@dataclass(frozen=True)
class CorpusItem:
    ref: str  # "peer:add.c", "web:x.c", "llm:x.c" in folder mode, or "sub:<id>" in DB mode
    kind: CorpusKind
    source: str
    file: str = ""

    @property
    def sha256(self) -> str:
        return sha256(self.source)


class CorpusProvider(Protocol):
    def peers(self, problem_id: str | None, exclude: str) -> list[CorpusItem]:
        """All corpus items (peers first, then web, then llm).

        exclude is the source of the submission being graded; items with the
        same content (ignoring whitespace) are dropped.
        """
        ...


def stripped_hash(source: str) -> str:
    return sha256(WS_RE.sub("", source))


def read_text(path: Path) -> str:
    return path.read_bytes().decode("utf-8", errors="replace")


def read_c_sources(folder: Path, kind: CorpusKind) -> list[CorpusItem]:
    if not folder.is_dir():
        return []
    names = sorted((p.name for p in folder.iterdir() if p.name.endswith(".c") and p.is_file()), key=text_sort_key)
    return [CorpusItem(f"{kind}:{n}", kind, read_text(folder / n), n) for n in names]


def corpus_hash(items: list[CorpusItem]) -> str:
    return "sha256:" + sha256("\n".join(sorted(i.sha256 for i in items)))


class FolderCorpus:
    def __init__(self, problem_dir: str | Path, filename: str, corpus_dir: str | None = None):
        self.problem_dir = Path(problem_dir)
        self.filename = filename
        self.corpus_dir = corpus_dir or "submissions"

    def peers(self, problem_id: str | None = None, exclude: str = "") -> list[CorpusItem]:
        me = stripped_hash(exclude)
        own = [
            p for p in read_c_sources(self.problem_dir / self.corpus_dir, "peer")
            if p.file != self.filename and stripped_hash(p.source) != me
        ]
        return [
            *own,
            *read_c_sources(self.problem_dir / "corpus" / "web", "web"),
            *read_c_sources(self.problem_dir / "corpus" / "llm", "llm"),
        ]
