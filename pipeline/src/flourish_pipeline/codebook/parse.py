"""Classified lines → :class:`RawEntry` records. Pure; no I/O, no pdfplumber.

The tricky part is that the three block labels are *vertically centred*
beside their content, so in reading order a label can appear above, level
with, or below any given content line, and ``Value labels:`` routinely sits
in the middle of its list. Two rules recover the structure:

1. Any content line matching ``code = label`` (or the en-dash variant used
   by the system variables, or the glued ``1=`` of ``WAVE_MY``) is a value
   label no matter which label it sits beside. A non-matching content line
   directly after a value label is a continuation of that label's text
   (long labels wrap, e.g. ``EDUCATION_3``, and long lists cross pages).
2. The remaining plain-text lines belong to the ``Variable Label`` /
   ``Question Wording`` blocks. Because each label is centred on its own
   block, the split point between the two blocks is chosen to minimise the
   distance between each label and the midpoint of the lines assigned to it.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from .model import Line, RawEntry, ValueLabelRaw

# Separators seen in the wild: " = " everywhere, the glued "1=" of WAVE_MY,
# the en dash of MODE_* / MIDYEAR_TYPE_MY, and the period of REL9
# ("-98. (Saw, skipped)"). The dash/period forms require a following space so
# ranges ("1–2 hours") and decimals never match; a plain hyphen is not a
# separator at all ("(9-15 years of education)" must not open a value label).
VALUE_LABEL_RE = re.compile(r"^(-?\d+)\s*=\s*(.+)$|^(-?\d+)\s*[–.]\s+(.+)$")
# REL9 lists most codes with no separator at all ("1 Jodo sect (Honen)").
# Only trusted while a value list is already open, so wording lines that
# happen to start with a number cannot open one.
_BARE_VALUE_RE = re.compile(r"^(-?\d{1,4})\s+(\S.*)$")

_SKIP_SECTIONS = frozenset({"table of contents"})


@dataclass(slots=True)
class _Positioned:
    order: float  # page * 10_000 + y: monotonic within the document
    text: str


class _EntryBuilder:
    def __init__(self, heading: str, section: str | None, page: int) -> None:
        self.heading = heading
        self.section = section
        self.page_from = page
        self.page_to = page
        self.labels: dict[str, float] = {}  # block kind -> order of its label line
        self.texts: list[_Positioned] = []
        self.values: list[ValueLabelRaw] = []
        self._last_content_was_value = False

    def see_page(self, page: int) -> None:
        self.page_to = max(self.page_to, page)

    def add_label(self, line: Line) -> None:
        self.see_page(line.page)
        lowered = line.text.lower()
        if lowered.startswith("variable label"):
            kind = "variable_label"
        elif lowered.startswith("question wording"):
            kind = "wording"
        else:
            kind = "value_labels"
        self.labels.setdefault(kind, _order(line))

    def add_content(self, line: Line) -> None:
        self.see_page(line.page)
        match = VALUE_LABEL_RE.match(line.text)
        if match:
            code, label = (
                (match.group(1), match.group(2))
                if match.group(1)
                else (
                    match.group(3),
                    match.group(4),
                )
            )
            self.values.append(ValueLabelRaw(int(code), label.strip()))
            self._last_content_was_value = True
            return
        if self._last_content_was_value and self.values:
            bare = _BARE_VALUE_RE.match(line.text)
            if bare:  # REL9's separator-less rows continue the open list
                self.values.append(ValueLabelRaw(int(bare.group(1)), bare.group(2).strip()))
            else:  # wrapped label text ("EDUCATION_3", page breaks)
                last = self.values[-1]
                self.values[-1] = ValueLabelRaw(last.code, f"{last.label} {line.text.strip()}")
            return
        self.texts.append(_Positioned(_order(line), line.text))

    def finish(self) -> RawEntry:
        variable_label, wording = _split_blocks(
            self.texts,
            self.labels.get("variable_label"),
            self.labels.get("wording"),
        )
        return RawEntry(
            heading=self.heading,
            section=self.section,
            variable_label=variable_label,
            wording=wording,
            value_labels=self.values,
            page_from=self.page_from,
            page_to=self.page_to,
        )


def _order(line: Line) -> float:
    return line.page * 10_000 + line.y


def _join(texts: list[_Positioned]) -> str | None:
    return "\n".join(t.text for t in texts) if texts else None


def _split_blocks(
    texts: list[_Positioned],
    label_order: float | None,
    wording_order: float | None,
) -> tuple[str | None, str | None]:
    """Assign plain-text lines to the Variable Label vs Question Wording block.

    Tries every split of the (already ordered) lines into a leading label
    block and a trailing wording block, and keeps the split for which each
    label sits closest to the vertical midpoint of its block — which is how
    the PDF lays them out.
    """
    if not texts:
        return None, None
    if wording_order is None:
        return _join(texts), None
    if label_order is None:
        return None, _join(texts)

    def block_cost(block: list[_Positioned], label_at: float) -> float:
        if not block:
            return 0.0
        midpoint = (block[0].order + block[-1].order) / 2
        return abs(midpoint - label_at)

    best_split = 0
    best_cost = float("inf")
    for split in range(len(texts) + 1):
        cost = block_cost(texts[:split], label_order) + block_cost(texts[split:], wording_order)
        if cost < best_cost:
            best_cost = cost
            best_split = split
    return _join(texts[:best_split]), _join(texts[best_split:])


def parse_entries(lines: list[Line]) -> list[RawEntry]:
    """Group classified lines into codebook entries.

    Content before the first heading of a section (the TOC page numbers,
    the page-3 intro paragraph) is dropped. Consecutive section lines on
    one page merge ("Country Specific" + "Demographic Variables").
    """
    entries: list[RawEntry] = []
    builder: _EntryBuilder | None = None
    section: str | None = None
    previous_was_section = False
    section_page = -1

    for line in lines:
        if line.column == "section":
            if builder is not None:
                entries.append(builder.finish())
                builder = None
            if previous_was_section and section is not None and line.page == section_page:
                section = f"{section} {line.text}"
            else:
                section = line.text
            section_page = line.page
            previous_was_section = True
            continue
        previous_was_section = False
        if section is not None and section.lower() in _SKIP_SECTIONS:
            continue
        if line.column == "heading":
            if builder is not None:
                entries.append(builder.finish())
            builder = _EntryBuilder(line.text, section, line.page)
        elif builder is None:
            continue  # stray content outside any entry
        elif line.column == "label":
            builder.add_label(line)
        else:
            builder.add_content(line)

    if builder is not None:
        entries.append(builder.finish())
    return entries
