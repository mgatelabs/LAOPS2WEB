"""
png2webp.py — Convert PNG images under the saves directory to WebP.

Walks the saves tree recursively.  Every `.png` file is resized so that it
fits within 128×128 px (aspect ratio preserved, never upscaled) using
LANCZOS, and saved as a `.webp` with the same name (extension only changed)
in the same folder.  The source PNG is left untouched.

Usage:
    python scripts/png2webp.py
    python scripts/png2webp.py --saves source/saves
    python scripts/png2webp.py --saves source/saves --size 128x128 --force
"""

import argparse
import sys
from pathlib import Path

try:
    from PIL import Image
except ImportError:
    sys.exit("ERROR: missing dependency: Pillow\n  pip install Pillow")


def parse_size(value: str) -> tuple[int, int]:
    w, sep, h = value.lower().partition("x")
    if not sep:
        sys.exit(f"ERROR: --size must be WxH, got: {value!r}")
    try:
        width, height = int(w), int(h)
    except ValueError:
        sys.exit(f"ERROR: --size must be WxH numbers, got: {value!r}")
    if width <= 0 or height <= 0:
        sys.exit(f"ERROR: --size dimensions must be positive, got: {value!r}")
    return width, height


def convert_dir(folder: Path, saves_root: Path, size: tuple[int, int], force: bool, stats: dict, errors: list) -> None:
    for png in sorted(folder.glob("*.png"), key=lambda p: p.name.lower()):
        webp = png.with_suffix(".webp")

        if not force and webp.exists() and webp.stat().st_mtime >= png.stat().st_mtime:
            stats["skipped"] += 1
            continue

        try:
            img = Image.open(str(png))
            img.thumbnail(size, Image.LANCZOS)
            if img.mode not in ("RGB", "RGBA"):
                img = img.convert("RGBA")
            img.save(str(webp), "WEBP", quality=90)
            stats["converted"] += 1
            print(f"  converted {png.relative_to(saves_root).as_posix()} -> {webp.name}  ({img.width}x{img.height})")
        except Exception as e:
            errors.append(f"Failed {png}: {e}")
            stats["errors"] += 1

    for sub in sorted(folder.iterdir(), key=lambda p: p.name.lower()):
        if sub.is_dir():
            convert_dir(sub, saves_root, size, force, stats, errors)


def main() -> None:
    if hasattr(sys.stdout, "reconfigure"):
        try:
            sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        except (ValueError, OSError):
            pass

    parser = argparse.ArgumentParser(description="Convert PNG images under the saves directory to WebP (<= size).")
    parser.add_argument("--saves", required=True, type=Path, help="Saves root directory")
    parser.add_argument("--size", default="128x128", help="Max output size WxH (default: 128x128)")
    parser.add_argument("--force", action="store_true", help="Re-convert even when the .webp is already newer than the .png")
    args = parser.parse_args()

    saves = args.saves.resolve()
    if not saves.is_dir():
        sys.exit(f"ERROR: --saves not found: {saves}")

    size = parse_size(args.size)
    stats = {"converted": 0, "skipped": 0, "errors": 0}
    errors: list = []

    print(f"Saves: {saves}")
    print(f"Size:  {size[0]}x{size[1]}")
    print(f"Mode:  {'force' if args.force else 'incremental'}\n")

    convert_dir(saves, saves, size, args.force, stats, errors)

    print(f"\n{stats['converted']} converted, {stats['skipped']} skipped, {stats['errors']} error(s)")
    if errors:
        print("\nErrors:")
        for e in errors:
            print(f"  {e}")
    if errors:
        sys.exit(1)


if __name__ == "__main__":
    main()
