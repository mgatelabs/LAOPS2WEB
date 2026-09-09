"""
init_catalog.py — Bootstrap missing _folder.json and {file}.json sidecars.

Creates sidecar files with placeholder content and assigns stable opaque IDs.
Existing sidecars are NEVER overwritten — safe to re-run on partially-bootstrapped trees.

New sidecars are written to a temporary directory first, then copied into the
target tree.  If anything goes wrong before the copy step, no source files are
touched.

Usage:
    python scripts/init_catalog.py --root content --target content/objects/NewFolder
    python scripts/init_catalog.py --root content --target content/objects/NewFolder --dry-run

Arguments:
    --root     Root content directory (scanned in full to avoid ID collisions).
    --target   Folder to bootstrap (must be inside --root). Recurses into subfolders.
    --dry-run  Print what would be created without writing any files.
"""

import argparse
import json
import shutil
import sys
import tempfile
from pathlib import Path


COUNTERS_FILE  = "_counters.json"
FOLDER_SIDECAR = "_folder.json"
INITIAL_COUNTERS = {"nextFolder": "64", "nextItem": "3"}

SECTION_NAMES = {"objects", "parts", "multicolor"}


# ---------------------------------------------------------------------------
# Counter helpers
# ---------------------------------------------------------------------------

def load_counters(root: Path) -> dict:
    path = root / COUNTERS_FILE
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))
    return dict(INITIAL_COUNTERS)


def save_counters(root: Path, counters: dict, dry_run: bool) -> None:
    path = root / COUNTERS_FILE
    if dry_run:
        print(f"  [dry-run] would write {path}")
        return
    path.write_text(json.dumps(counters, indent=2) + "\n", encoding="utf-8")


def next_folder_id(name: str, counters: dict, used_ids: set) -> tuple[str, dict]:
    initial = name[0].upper() if name else "X"
    counter = int(counters["nextFolder"], 16)
    while True:
        candidate = f"{initial}{format(counter, 'x')}"
        counter += 1
        if candidate not in used_ids:
            break
    return candidate, dict(counters, nextFolder=format(counter, "x"))


def next_item_id(filename: str, counters: dict, used_ids: set) -> tuple[str, dict]:
    stem   = Path(filename).stem.upper()
    prefix = (stem + "XX")[:2]
    counter = int(counters["nextItem"])
    while True:
        candidate = f"{prefix}{counter}"
        counter += 1
        if candidate not in used_ids:
            break
    return candidate, dict(counters, nextItem=str(counter))


# ---------------------------------------------------------------------------
# Scan existing sidecars to collect all used IDs
# ---------------------------------------------------------------------------

def collect_used_ids(root: Path) -> set:
    used = set()
    for json_path in root.rglob("*.json"):
        if json_path.name == COUNTERS_FILE:
            continue
        try:
            data = json.loads(json_path.read_text(encoding="utf-8"))
            if "id" in data:
                used.add(data["id"])
        except Exception:
            pass
    return used


# ---------------------------------------------------------------------------
# Bootstrap a single folder (non-recursive — caller recurses)
# ---------------------------------------------------------------------------

def bootstrap_folder(
    folder: Path,
    root: Path,
    tmp_root: Path,
    counters: dict,
    used_ids: set,
    pending: list,
) -> dict:
    """
    Stage a _folder.json (if missing) and item sidecars into tmp_root,
    appending (tmp_path, real_path) pairs to *pending*.
    Returns updated counters.
    """
    sidecar = folder / FOLDER_SIDECAR
    if not sidecar.exists():
        folder_id, counters = next_folder_id(folder.name, counters, used_ids)
        used_ids.add(folder_id)
        data = {
            "id":          folder_id,
            "label":       folder.name,
            "description": "",
            "author":      "",
        }
        rel = sidecar.relative_to(root)
        tmp_sidecar = tmp_root / rel
        tmp_sidecar.parent.mkdir(parents=True, exist_ok=True)
        tmp_sidecar.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
        pending.append((tmp_sidecar, sidecar))
        print(f"  staged  {sidecar}  (id={folder_id})")
    else:
        print(f"  skip    {sidecar}  (exists)")

    for svg in sorted(folder.glob("*.svg"), key=lambda p: p.name.lower()):
        item_sidecar = svg.with_suffix(".json")
        if not item_sidecar.exists():
            item_id, counters = next_item_id(svg.name, counters, used_ids)
            used_ids.add(item_id)
            data = {
                "id":          item_id,
                "label":       svg.stem,
                "description": "",
                "author":      "",
                "tags":        [],
            }
            rel = item_sidecar.relative_to(root)
            tmp_item = tmp_root / rel
            tmp_item.parent.mkdir(parents=True, exist_ok=True)
            tmp_item.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
            pending.append((tmp_item, item_sidecar))
            print(f"  staged  {item_sidecar}  (id={item_id})")
        else:
            print(f"  skip    {item_sidecar}  (exists)")

    return counters


# ---------------------------------------------------------------------------
# Recurse through target folder and all subfolders
# ---------------------------------------------------------------------------

def bootstrap_tree(
    target: Path,
    root: Path,
    tmp_root: Path,
    counters: dict,
    used_ids: set,
    pending: list,
) -> dict:
    print(f"\nFolder: {target}")
    counters = bootstrap_folder(target, root, tmp_root, counters, used_ids, pending)
    for sub in sorted(target.iterdir(), key=lambda p: p.name.lower()):
        if sub.is_dir():
            counters = bootstrap_tree(sub, root, tmp_root, counters, used_ids, pending)
    return counters


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(description="Bootstrap missing sidecar files for SVG assets.")
    parser.add_argument("--root",    required=True, type=Path, help="Root content directory")
    parser.add_argument("--target",  required=True, type=Path, help="Folder to bootstrap (inside --root)")
    parser.add_argument("--dry-run", action="store_true", help="Print actions without writing files")
    args = parser.parse_args()

    root   = args.root.resolve()
    target = args.target.resolve()

    if not root.is_dir():
        sys.exit(f"ERROR: --root does not exist or is not a directory: {root}")
    if not target.is_dir():
        sys.exit(f"ERROR: --target does not exist or is not a directory: {target}")
    try:
        target.relative_to(root)
    except ValueError:
        sys.exit(f"ERROR: --target must be inside --root\n  root:   {root}\n  target: {target}")

    print(f"Root:   {root}")
    print(f"Target: {target}")
    print(f"Mode:   {'dry-run' if args.dry_run else 'write'}\n")

    counters = load_counters(root)
    used_ids = collect_used_ids(root)
    pending: list[tuple[Path, Path]] = []

    tmp_root = Path(tempfile.mkdtemp(prefix="laops_init_"))
    try:
        counters = bootstrap_tree(target, root, tmp_root, counters, used_ids, pending)

        if args.dry_run:
            print(f"\n[dry-run] {len(pending)} sidecar(s) would be created.")
            save_counters(root, counters, dry_run=True)
        else:
            for tmp_file, real_file in pending:
                shutil.copy2(tmp_file, real_file)
            save_counters(root, counters, dry_run=False)
            print(f"\nDone. {len(pending)} sidecar(s) created.")
    finally:
        shutil.rmtree(tmp_root, ignore_errors=True)


if __name__ == "__main__":
    main()
