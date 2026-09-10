"""Typed records shared by the codebook parsing stages."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal

LineColumn = Literal["label", "content", "heading", "section"]

WAVES: tuple[str, ...] = ("Y1", "MY", "Y2")


@dataclass(frozen=True, slots=True)
class Line:
    """One classified line of codebook text.

    ``column`` says which layout column the words came from:

    - ``label``   — the narrow left column (``Variable Label:`` etc.)
    - ``content`` — the right column (wording, value labels)
    - ``heading`` — a centred bold ALL-CAPS variable heading
    - ``section`` — a large-type section title page

    A single visual row can produce both a ``label`` and a ``content``
    line (the labels are vertically centred beside their block); the two
    then share the same ``(page, y)``.
    """

    page: int
    y: float
    column: LineColumn
    text: str


@dataclass(frozen=True, slots=True)
class ValueLabelRaw:
    """A ``code = label`` row exactly as printed in the codebook."""

    code: int
    label: str


@dataclass(slots=True)
class RawEntry:
    """One codebook entry (heading plus its three labelled blocks).

    ``variable_label`` and ``wording`` keep ``\\n`` between the original
    printed lines: the ``SELFID1 & SELFID2`` joint entry is split on those
    boundaries later. ``value_labels`` are in document order, continuation
    lines already folded into their label text.
    """

    heading: str
    section: str | None
    variable_label: str | None
    wording: str | None
    value_labels: list[ValueLabelRaw] = field(default_factory=list[ValueLabelRaw])
    page_from: int = 0
    page_to: int = 0
