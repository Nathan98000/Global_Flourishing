"""Codebook parsing: PDF → lines → entries → catalog.

Three stages, so the pure parts are testable without the PDF:

- ``extract``  — pdfplumber only; classifies PDF text into :class:`Line` records.
- ``parse``    — pure; groups lines into :class:`RawEntry` records.
- ``catalog``  — merges entries + CSV headers + hand-curated overrides into
  the variable catalog (``data/catalog.json``).
"""
