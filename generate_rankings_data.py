"""
data generator - single JSON output.

Scans data/ directory for subdirectories (fiction, protagonists, antagonists, …).
Reads all 20XX.txt files in each subfolder and writes rankings_data.json
containing every type.

JSON structure
--------------
{
  "types": [
    {
      "id":    "fiction",
      "label": "Fiction",
      "tiers": [{"tier": 1, "label": "Tier 1", "color": "#ef4444"}, ...],
      "years": ["2022", "2023", ...],
      "as_of_by_year": {"2022": "(As of April 3rd, 2022)", ...},
      "year_column_caption": {"2022": "As of April 3rd", ...},
      "tier_labels_by_year": {"2022": {"1.0": "Tier 1", ...}, ...},
      "data":  [{"name": "...", "year": "2022", "tier": 1, "rank": 5}, ...]
    },
    ...
  ]
}

Input file formats supported
------------------------------
Fiction      : "1. Title ↑↓~+"
Protagonists : "1) Character Name (Source) ↑↓~+"
Antagonists  : "1) Character Name (Source) ↑↓~+"
(Both formats are detected automatically via the ranked-item regex.)
"""

import glob
import json
import os
import re

from normalized_mappings_table import NAME_MAPS, SPLIT_MAPS

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_ROOT = os.path.join(SCRIPT_DIR, "data")
OUTPUT = os.path.join(SCRIPT_DIR, "rankings_data.json")

CHARACTER_TYPES: set[str] = {"protagonists", "antagonists"}

TIER_COLORS: dict[int, str] = {
    1: "#9900ff",
    2: "#674ea7",
    3: "#20124d",
    4: "#741b47",
    5: "#ff0000",
    6: "#e69138",
    7: "#bf9000",
    8: "#38761d",
    9: "#4a86e8",
    10: "#0000ff",
    999: "#64748b",
}


def clean_name(raw: str) -> str:
    name = re.sub(r"\s*[↑↓].*$", "", raw)
    name = re.sub(r"\s*[~+\-]\s*$", "", name)
    return name.strip()


def normalize(raw: str, name_map: dict) -> str:
    cleaned = clean_name(raw)
    return name_map.get(cleaned, cleaned)


def extract_series(name: str) -> str | None:
    m = re.search(r'\(([^()]+)\)\s*$', name)
    return m.group(1).strip() if m else None


def tier_label(tier: float) -> str:
    if tier == 999.0:
        return "Honorable Mentions"
    return f"Tier {int(tier)}" if tier.is_integer() else f"Tier {tier:g}"


def tier_color(tier: float, index: int) -> str:
    if tier == 999.0:
        return TIER_COLORS[999]
    return TIER_COLORS.get(index + 1, "#94a3b8")


def split_hm(text: str) -> list[str]:
    parts, depth, current = [], 0, []
    for ch in text:
        if ch == "(":
            depth += 1
        elif ch == ")":
            depth -= 1
        if ch == "," and depth == 0:
            parts.append("".join(current).strip())
            current = []
        else:
            current.append(ch)
    if current:
        parts.append("".join(current).strip())
    return parts


def next_nonempty(lines: list[str], start: int) -> str | None:
    for i in range(start, len(lines)):
        candidate = lines[i].strip()
        if candidate:
            return candidate
    return None


def _strip_year_suffix(inner: str, file_year: str) -> str:
    y = file_year.strip()
    s = inner.strip()
    s = re.sub(rf",\s*{re.escape(y)}\s*$", "", s, flags=re.IGNORECASE)
    s = re.sub(rf"\s+{re.escape(y)}\s*$", "", s, flags=re.IGNORECASE)
    s = s.strip().rstrip(",").strip()
    return s or inner.strip()


def parse_list_date_from_txt(lines: list[str], file_year: str) -> tuple[str | None, str | None]:
    scanned: list[str] = []
    for raw in lines[:32]:
        line = raw.strip()
        if line:
            scanned.append(line)

    standalone = re.compile(r"^\(([^)]+)\)$")
    for line in scanned[:10]:
        m = standalone.match(line)
        if not m:
            continue
        inner = m.group(1).strip()
        low = inner.lower()
        ends_year = inner.endswith(file_year) or bool(
            re.search(rf"\b{re.escape(file_year)}\s*$", inner)
        )
        if "as of" in low or ends_year:
            cap = _strip_year_suffix(inner, file_year)
            return f"({inner})", cap

    if scanned:
        first = scanned[0]
        for m in re.finditer(r"\(([^)]+)\)", first):
            inner = m.group(1).strip()
            if inner.endswith(file_year) or re.search(
                    rf"\b{re.escape(file_year)}\s*$", inner
            ):
                cap = _strip_year_suffix(inner, file_year)
                return f"({inner})", cap

    return None, None


def process_type(type_name: str, input_dir: str, name_map: dict) -> dict | None:
    files = sorted(glob.glob(os.path.join(input_dir, "20*.txt")))
    if not files:
        print(f"  [{type_name}] No '20*.txt' files found - skipping.")
        return None

    observations: dict[tuple[str, str], list] = {}
    tiers_seen: set[float] = set()
    years: list[str] = []
    latest_tier_labels: dict[float, str] = {}
    tier_labels_by_year: dict[str, dict[str, str]] = {}
    as_of_by_year: dict[str, str] = {}
    year_column_caption: dict[str, str] = {}
    split_map = SPLIT_MAPS.get(type_name, {})

    for path in files:
        year = os.path.splitext(os.path.basename(path))[0]
        years.append(year)
        current_tier = 1.0
        next_text_tier = 1.0
        file_tier_labels: dict[float, str] = {}

        with open(path, "r", encoding="utf-8-sig") as fh:
            lines = fh.readlines()

        as_of_full, cap_no_year = parse_list_date_from_txt(lines, year)
        if as_of_full:
            as_of_by_year[year] = as_of_full
        if cap_no_year:
            year_column_caption[year] = cap_no_year

        for idx, raw_line in enumerate(lines):
            line = raw_line.strip()
            if not line:
                continue

            m = re.match(r"^TIER\s+([0-9.]+)\s*:\s*(.*)$", line, re.IGNORECASE)
            if m:
                current_tier = float(m.group(1))
                label = m.group(2).strip() or tier_label(current_tier)
                tiers_seen.add(current_tier)
                file_tier_labels[current_tier] = label
                if current_tier != 999.0:
                    next_text_tier = max(next_text_tier, current_tier + 1)
                continue

            next_line = next_nonempty(lines, idx + 1)
            is_rank_block = bool(
                next_line and (
                        re.match(r"^(\d+)[.)]\s+.*", next_line)
                        or re.match(r"^Honourable mentions:\s*(.*)", next_line, re.IGNORECASE)
                )
            )
            if is_rank_block and re.match(r"^[A-Za-z].*", line):
                header = line.rstrip(":").strip()
                lower_header = header.lower()
                if lower_header not in {"legend"} and not lower_header.startswith("honourable mentions"):
                    if lower_header in {"just missed out"}:
                        current_tier = 9.0
                    else:
                        current_tier = next_text_tier
                        next_text_tier += 1
                    tiers_seen.add(current_tier)
                    file_tier_labels[current_tier] = header
                    continue

            m = re.match(r"^(\d+)[.)]\s+(.*)", line)
            if m:
                rank = int(m.group(1))
                raw_name = m.group(2)
                cleaned = clean_name(raw_name)
                targets = split_map.get(cleaned)
                if targets:
                    for target in targets:
                        key = (target, year)
                        if key not in observations:
                            observations[key] = []
                        observations[key].append({"tier": current_tier, "rank": rank, "exact": cleaned})
                else:
                    name = name_map.get(cleaned, cleaned)
                    key = (name, year)
                    if key not in observations:
                        observations[key] = []
                    observations[key].append({"tier": current_tier, "rank": rank, "exact": cleaned})
                tiers_seen.add(current_tier)
                continue

            m = re.match(r"^Honourable mentions:\s*(.*)", line, re.IGNORECASE)
            if m:
                current_tier = 999.0
                tiers_seen.add(current_tier)
                file_tier_labels[current_tier] = "Honorable Mentions"
                for raw in split_hm(m.group(1)):
                    raw = raw.strip()
                    if not raw:
                        continue
                    cleaned = clean_name(raw)
                    targets = split_map.get(cleaned)
                    if targets:
                        for target in targets:
                            key = (target, year)
                            if key not in observations:
                                observations[key] = []
                            observations[key].append({"tier": 999.0, "rank": "HM", "exact": cleaned})
                    else:
                        name = name_map.get(cleaned, cleaned)
                        key = (name, year)
                        if key not in observations:
                            observations[key] = []
                        observations[key].append({"tier": 999.0, "rank": "HM", "exact": cleaned})

        latest_tier_labels.update(file_tier_labels)
        tier_labels_by_year[year] = {str(k): v for k, v in file_tier_labels.items()}

    years.sort()
    tiers_sorted = sorted(tiers_seen)

    tiers_out = [
        {
            "tier": t,
            "label": latest_tier_labels.get(t, tier_label(t)),
            "color": tier_color(t, i),
        }
        for i, t in enumerate(tiers_sorted)
    ]

    is_char_type = type_name in CHARACTER_TYPES
    data_out = []
    for (name, year) in sorted(observations.keys(), key=lambda k: (k[0], k[1])):
        obs_list = observations[(name, year)]
        obs_list.sort(key=lambda o: (o["rank"] == "HM", int(o["rank"]) if o["rank"] != "HM" else 999))
        best = obs_list[0]
        entry: dict = {
            "name": name,
            "year": year,
            "tier": best["tier"],
            "rank": best["rank"],
            "exact": best["exact"],
        }
        if len(obs_list) > 1:
            entry["sub_entries"] = [
                {"rank": o["rank"], "tier": o["tier"], "exact": o["exact"]}
                for o in obs_list
            ]
        if is_char_type:
            entry["series"] = extract_series(name)
        data_out.append(entry)

    unique_items = {n for (n, _) in observations.keys()}
    print(
        f"  [{type_name}]  {len(unique_items):>4} items  "
        f"{len(years)} years  {len(tiers_sorted)} tiers"
    )

    return {
        "id": type_name,
        "label": type_name.capitalize(),
        "tiers": tiers_out,
        "years": years,
        "as_of_by_year": as_of_by_year,
        "year_column_caption": year_column_caption,
        "tier_labels_by_year": tier_labels_by_year,
        "data": data_out,
    }


def main() -> None:
    if not os.path.isdir(DATA_ROOT):
        print(f"data/ directory not found at: {DATA_ROOT}")
        return

    type_dirs = sorted(
        d for d in os.listdir(DATA_ROOT)
        if os.path.isdir(os.path.join(DATA_ROOT, d)) and not d.startswith(".")
    )

    if not type_dirs:
        print("No subdirectories found in data/ - nothing to process.")
        return

    print(f"Found {len(type_dirs)} type(s): {', '.join(type_dirs)}\n")

    all_types = []
    for type_name in type_dirs:
        result = process_type(
            type_name,
            os.path.join(DATA_ROOT, type_name),
            NAME_MAPS.get(type_name, {}),
        )
        if result:
            all_types.append(result)

    with open(OUTPUT, "w", encoding="utf-8") as fh:
        json.dump({"types": all_types}, fh, indent=2, ensure_ascii=False)

    print(f"\nWritten: {os.path.basename(OUTPUT)}")
    print("Open index.html via a local server to view.")
    print("  python3 -m http.server  ->  http://localhost:8000/index.html")


if __name__ == "__main__":
    main()
