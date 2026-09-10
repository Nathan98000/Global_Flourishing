"""PDF → classified :class:`Line` records. The only module that imports pdfplumber.

Layout facts this classification rests on (GFS Wave 2 codebook, 84 pages):

- Section titles are 26 pt bold ("Main Survey Questions", …); the
  two-line "Country Specific / Demographic Variables" title is merged later
  by the parser. Page 2's 26 pt "Table of Contents" also comes through as a
  section; the parser drops it because no headings follow it.
- Variable headings are 10 pt bold, ALL CAPS, centred (x0 ≈ 236–301).
- The label column ("Variable Label:", "Question Wording:", "Value labels:")
  is bold and ends by x ≈ 145; block content starts at x ≈ 163–185. A split
  at x = 155 separates them cleanly, including rows where a vertically
  centred label sits level with content ("Value labels: 10 = Kenya").
- The page-3 intro paragraph and page-2 TOC rows are 8 pt italic / 16 pt
  left-column text respectively; both fall out of the size filter or the
  known-label check.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import pdfplumber

from .model import Line

# x position separating the label column from block content.
_X_SPLIT = 155.0
# Variable headings are centred; nothing else bold starts this far right.
_HEADING_MIN_X = 200.0
# Section titles are 26 pt; everything inside entries is 10 pt.
_SECTION_MIN_SIZE = 20.0
# Drops the 8 pt italic intro paragraph on page 3.
_MIN_SIZE = 9.0
# Words within this vertical distance belong to one visual row.
_ROW_TOLERANCE = 3.0

_LABEL_PREFIXES = ("variable label", "question wording", "value labels")


def _is_heading(words: list[dict[str, Any]], text: str) -> bool:
    first = words[0]
    fontname: str = first["fontname"]
    size: float = first["size"]
    x0: float = first["x0"]
    if "Bold" not in fontname or size >= _SECTION_MIN_SIZE or x0 < _HEADING_MIN_X:
        return False
    # ALL-CAPS variable names, incl. "SELFID1 & SELFID2"; never starts with a digit.
    return all(ch.isupper() or ch.isdigit() or ch in "_& " for ch in text) and text[0].isupper()


def _rows(words: list[dict[str, Any]]) -> list[list[dict[str, Any]]]:
    rows: list[list[dict[str, Any]]] = []
    for word in sorted(words, key=lambda w: (float(w["top"]), float(w["x0"]))):
        if rows and abs(float(rows[-1][0]["top"]) - float(word["top"])) < _ROW_TOLERANCE:
            rows[-1].append(word)
        else:
            rows.append([word])
    return rows


def extract_lines(pdf_path: Path) -> list[Line]:
    """Read the codebook PDF into classified lines, in reading order."""
    lines: list[Line] = []
    with pdfplumber.open(pdf_path) as pdf:
        for page_number, page in enumerate(pdf.pages, start=1):
            words = [
                w
                for w in page.extract_words(extra_attrs=["fontname", "size"])
                if float(w["size"]) >= _MIN_SIZE
            ]
            for row in _rows(words):
                y = round(float(row[0]["top"]), 1)
                row.sort(key=lambda w: float(w["x0"]))
                if any(float(w["size"]) >= _SECTION_MIN_SIZE for w in row):
                    text = " ".join(str(w["text"]) for w in row)
                    lines.append(Line(page_number, y, "section", text))
                    continue
                left = [w for w in row if float(w["x0"]) < _X_SPLIT]
                right = [w for w in row if float(w["x0"]) >= _X_SPLIT]
                if left:
                    text = " ".join(str(w["text"]) for w in left)
                    if text.lower().startswith(_LABEL_PREFIXES):
                        lines.append(Line(page_number, y, "label", text))
                    # else: stray left-column text (TOC rows); dropped.
                if right:
                    text = " ".join(str(w["text"]) for w in right)
                    column = "heading" if _is_heading(right, text) else "content"
                    lines.append(Line(page_number, y, column, text))
    return lines
