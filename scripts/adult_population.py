"""Rebuild stats/src/flourish_stats/data/adult_population.csv from the UN.

The pooled "All countries" estimates weight each country by its adult
population (ADR-0020): the UN World Population Prospects 2024 estimates of
the population aged 18 and over on 1 July 2023. This script derives those
23 numbers from the UN's own single-age file — nothing is typed by hand:

    uv run python scripts/adult_population.py            # downloads the file
    uv run python scripts/adult_population.py --source WPP2024_...csv.gz

The file (about 62 MB) is read as a gzipped CSV, streamed; only the 2023
rows of the GFS countries are kept, their single-year ages 18 through
"100+" summed (the UN reports thousands; the table stores persons). The
UN's "China" (CHN) excludes Hong Kong, which it reports as "China, Hong
Kong SAR" under HKG — the same split as the GFS's two samples. The
download, when needed, goes to a temporary directory and never into git.
"""

from __future__ import annotations

import argparse
import csv
import gzip
import hashlib
import sys
import tempfile
import urllib.request
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
TARGET = REPO_ROOT / "stats" / "src" / "flourish_stats" / "data" / "adult_population.csv"

#: The UN's single-age population estimates, 1950-2023 (medium variant),
#: from https://population.un.org/wpp/downloads (CSV format).
WPP_FILE = "WPP2024_PopulationBySingleAgeSex_Medium_1950-2023.csv.gz"
WPP_URL = (
    "https://population.un.org/wpp/assets/Excel%20Files/1_Indicator%20(Standard)/CSV_FILES/"
    + WPP_FILE
)
YEAR = 2023
ADULT_AGE = 18
SOURCE = "UN World Population Prospects 2024, ages 18+, 1 July 2023"

#: The 23 GFS countries by ISO 3166 alpha-3 code — the release's own
#: `countries.iso3` (a `built` test holds the table to the catalog).
GFS_ISO3 = (
    "ARG",
    "AUS",
    "BRA",
    "CHN",
    "DEU",
    "EGY",
    "ESP",
    "GBR",
    "HKG",
    "IDN",
    "IND",
    "ISR",
    "JPN",
    "KEN",
    "MEX",
    "NGA",
    "PHL",
    "POL",
    "SWE",
    "TUR",
    "TZA",
    "USA",
    "ZAF",
)


def download(directory: Path) -> Path:
    path = directory / WPP_FILE
    print(f"downloading {WPP_URL}", file=sys.stderr)
    urllib.request.urlretrieve(WPP_URL, path)
    return path


def adult_populations(source: Path) -> dict[str, int]:
    """ISO3 → persons aged 18+ on 1 July 2023, from the single-age file."""
    thousands: dict[str, float] = dict.fromkeys(GFS_ISO3, 0.0)
    ages: dict[str, int] = dict.fromkeys(GFS_ISO3, 0)
    with gzip.open(source, "rt", encoding="utf-8-sig", newline="") as handle:
        for row in csv.DictReader(handle):
            iso3 = row["ISO3_code"]
            if iso3 not in thousands or int(row["Time"]) != YEAR:
                continue
            if int(row["AgeGrpStart"]) >= ADULT_AGE:
                thousands[iso3] += float(row["PopTotal"])
                ages[iso3] += 1
    # Ages 18, 19, …, 99 and the open "100+" group: 83 rows per country.
    missing = [iso3 for iso3, count in ages.items() if count != 100 - ADULT_AGE + 1]
    if missing:
        raise SystemExit(f"{source.name}: incomplete {YEAR} age rows for {missing}")
    return {iso3: round(value * 1000) for iso3, value in thousands.items()}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--source", type=Path, help=f"a local copy of {WPP_FILE}")
    args = parser.parse_args()
    with tempfile.TemporaryDirectory() as tmp:
        source: Path = args.source or download(Path(tmp))
        digest = hashlib.sha256(source.read_bytes()).hexdigest()
        populations = adult_populations(source)
    TARGET.parent.mkdir(parents=True, exist_ok=True)
    with TARGET.open("w", newline="") as handle:
        writer = csv.writer(handle, lineterminator="\n")
        writer.writerow(["iso3", "adult_population", "year", "source"])
        for iso3 in sorted(populations):
            writer.writerow([iso3, populations[iso3], YEAR, SOURCE])
    total = sum(populations.values())
    share = (populations["CHN"] + populations["IND"]) / total
    print(
        f"{TARGET.relative_to(REPO_ROOT)}: {len(populations)} countries, "
        f"{total:,} adults; China + India {share:.1%} (from {source.name}, sha256 {digest})"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
