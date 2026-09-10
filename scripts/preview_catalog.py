"""
preview_catalog.py — Render WebP preview thumbnails for SVG assets.

Walks the content directory (same structure as post_catalog.py expects),
finds every SVG with a valid sidecar, and renders a 128×128 WebP preview
on a checkerboard background.  Uses content/_index.json to skip assets
whose SVG and sidecar have not changed since the last run.

Run this independently of post_catalog.py — you do not need a finished
catalogue to generate previews.

Usage:
    python scripts/preview_catalog.py \
        --content  content \
        --previews src/assets/previews

    # Force re-render everything, ignoring the cache:
    python scripts/preview_catalog.py \
        --content  content \
        --previews src/assets/previews \
        --force

    # Preview a single subfolder only:
    python scripts/preview_catalog.py \
        --content  content \
        --previews src/assets/previews \
        --target   content/objects/Bodys

Dependencies:
    pip install cairosvg Pillow lxml
"""

import argparse
import shutil
import sys
import tempfile
from pathlib import Path

from _common import (
    SECTION_NAMES,
    check_deps,
    load_index,
    load_item_sidecar,
    preview_is_fresh,
    publish_dir,
    render_preview,
    save_index,
    update_index_entry,
    ValidationError,
)


# ---------------------------------------------------------------------------
# Recursive renderer
# ---------------------------------------------------------------------------

def render_folder(
    folder: Path,
    content_root: Path,
    tmp_previews: Path,
    previews_root: Path,
    index: dict,
    force: bool,
    errors: list,
    stats: dict,
) -> None:
    for svg in sorted(folder.glob("*.svg"), key=lambda p: p.name.lower()):
        try:
            item_meta = load_item_sidecar(svg)
        except ValidationError as e:
            errors.append(str(e))
            stats["errors"] += 1
            continue

        asset_id  = item_meta["id"]
        sidecar   = svg.with_suffix(".json")
        prev_dest = tmp_previews / f"{asset_id}.webp"
        existing  = previews_root / f"{asset_id}.webp"

        if not force and preview_is_fresh(asset_id, svg, sidecar, index) and existing.exists():
            # Copy the cached preview into the temp tree so publish_dir includes it
            shutil.copy2(existing, prev_dest)
            stats["skipped"] += 1
        else:
            try:
                render_preview(svg, prev_dest)
                update_index_entry(asset_id, svg, sidecar, index)
                stats["rendered"] += 1
                rel = svg.relative_to(content_root)
                print(f"  rendered {rel}")
            except Exception as e:
                errors.append(f"Preview failed for {svg}: {e}")
                stats["errors"] += 1

    for sub in sorted(folder.iterdir(), key=lambda p: p.name.lower()):
        if sub.is_dir():
            render_folder(sub, content_root, tmp_previews, previews_root, index, force, errors, stats)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(description="Render WebP preview thumbnails for SVG assets.")
    parser.add_argument("--content",  required=True, type=Path, help="Root content directory")
    parser.add_argument("--previews", required=True, type=Path, help="Output directory for WebP previews")
    parser.add_argument("--target",   type=Path, default=None,  help="Render only this subfolder (must be inside --content)")
    parser.add_argument("--force",    action="store_true",      help="Re-render all previews, ignoring the cache")
    args = parser.parse_args()

    content  = args.content.resolve()
    previews = args.previews.resolve()

    if not content.is_dir():
        sys.exit(f"ERROR: --content not found: {content}")

    target = content
    if args.target:
        target = args.target.resolve()
        if not target.is_dir():
            sys.exit(f"ERROR: --target not found: {target}")
        try:
            target.relative_to(content)
        except ValueError:
            sys.exit(f"ERROR: --target must be inside --content\n  content: {content}\n  target:  {target}")

    check_deps()

    index  = load_index(content)
    errors: list = []
    stats  = {"rendered": 0, "skipped": 0, "errors": 0}

    tmp_root     = Path(tempfile.mkdtemp(prefix="laops_previews_"))
    tmp_previews = tmp_root / "previews"
    tmp_previews.mkdir()

    try:
        if target == content:
            # Walk section subdirectories
            for section_id in SECTION_NAMES:
                section_dir = content / section_id
                if not section_dir.is_dir():
                    continue
                for folder in sorted(section_dir.iterdir(), key=lambda p: p.name.lower()):
                    if folder.is_dir():
                        render_folder(folder, content, tmp_previews, previews, index, args.force, errors, stats)
        else:
            render_folder(target, content, tmp_previews, previews, index, args.force, errors, stats)

        publish_dir(tmp_previews, previews)

    finally:
        shutil.rmtree(tmp_root, ignore_errors=True)

    save_index(content, index)

    print(f"\n{stats['rendered']} rendered, {stats['skipped']} skipped, {stats['errors']} error(s)")
    if errors:
        print("\nErrors:")
        for e in errors:
            print(f"  {e}")

    if errors:
        sys.exit(1)


if __name__ == "__main__":
    main()
