"""
make_spooky.py — Generate a Zalgo/spooky variant of en.json.

Walks every string value in the English translation file and applies
randomised Unicode combining diacritics to each character, producing
the cursed "Zalgo" text effect.  Template tokens ({{ ... }}) are left
untouched so Angular's i18n interpolation still works.

Usage:
    python scripts/make_spooky.py
    python scripts/make_spooky.py --seed 42          # reproducible output
    python scripts/make_spooky.py --intensity 3       # 1–8 diacritics per char (default 4)
    python scripts/make_spooky.py --input  src/assets/i18n/en.json
    python scripts/make_spooky.py --output src/assets/i18n/spooky.json
"""

import argparse
import json
import random
import re
import sys
from pathlib import Path

# ---------------------------------------------------------------------------
# Zalgo diacritics — same set as MediaServerSite/config.py
# ---------------------------------------------------------------------------

_ZALGO_DIACRITICS = [
    "̀", "́", "̂", "̃", "̄", "̅", "̆", "̇",
    "̈", "̉", "̊", "̋", "̌", "̍", "̎", "̏",
    "̐", "̑", "̒", "̓", "̔", "̕", "̖", "̗",
    "̘", "̙", "̚", "̛", "̜", "̝", "̞", "̟",
    "̠", "̡", "̢", "̣", "̤", "̥", "̦", "̧",
    "̨", "̩", "̪", "̫", "̬", "̭", "̮", "̯",
    "̰", "̱", "̲", "̳", "̴", "̵", "̶", "̷",
    "̸", "̹", "̺", "̻", "̼", "̽", "̾", "̿",
    "̀", "́", "͂", "̓", "̈́", "ͅ", "͆", "͇",
    "͈", "͉", "͊", "͋", "͌", "͍", "͎", "͏",
    "͐", "͑", "͒", "͓", "͔", "͕", "͖", "͗",
    "͘", "͙", "͚", "͛", "͜", "͝", "͞", "͟",
    "͠", "͡", "͢",
]

# Matches Angular interpolation {{ ... }} and ICU-style {varName}
_TOKEN_RE = re.compile(r"(\{\{[^}]*\}\}|\{[^}]+\})")


def _zalgo_char(ch: str, intensity: int) -> str:
    """Append 1..intensity random diacritics to a single character."""
    return ch + "".join(random.choices(_ZALGO_DIACRITICS, k=random.randint(1, intensity)))


def zalgo_text(text: str, intensity: int) -> str:
    """Zalgo-ify a string, leaving template tokens untouched."""
    if not text:
        return text

    parts = _TOKEN_RE.split(text)
    out = []
    for part in parts:
        if _TOKEN_RE.fullmatch(part):
            out.append(part)          # token — pass through verbatim
        else:
            out.append("".join(_zalgo_char(ch, intensity) for ch in part))
    return "".join(out)


def make_spooky(data: object, intensity: int) -> object:
    """Recursively zalgo-ify all string values in a JSON structure."""
    if isinstance(data, dict):
        return {k: make_spooky(v, intensity) for k, v in data.items()}
    if isinstance(data, str):
        return zalgo_text(data, intensity)
    return data


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(
        description="Generate a Zalgo/spooky i18n file from en.json."
    )
    parser.add_argument(
        "--input", default="src/assets/i18n/en.json", type=Path,
        help="Source English JSON file (default: src/assets/i18n/en.json)",
    )
    parser.add_argument(
        "--output", default="src/assets/i18n/spooky.json", type=Path,
        help="Output Zalgo JSON file (default: src/assets/i18n/spooky.json)",
    )
    parser.add_argument(
        "--intensity", default=4, type=int, choices=range(1, 9), metavar="1-8",
        help="Max diacritics per character (default: 4)",
    )
    parser.add_argument(
        "--seed", default=None, type=int,
        help="Random seed for reproducible output",
    )
    args = parser.parse_args()

    if args.seed is not None:
        random.seed(args.seed)

    input_path: Path = args.input
    if not input_path.exists():
        sys.exit(f"ERROR: input file not found: {input_path}")

    print(f"Reading  {input_path}")
    with input_path.open(encoding="utf-8") as f:
        en_data = json.load(f)

    spooky_data = make_spooky(en_data, args.intensity)

    args.output.parent.mkdir(parents=True, exist_ok=True)
    print(f"Writing  {args.output}")
    with args.output.open("w", encoding="utf-8") as f:
        json.dump(spooky_data, f, indent=2, ensure_ascii=False)
        f.write("\n")

    print("Done.")


if __name__ == "__main__":
    main()
