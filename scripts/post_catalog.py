"""
post_catalog.py — Build the asset catalogue and scene catalogue.

Reads validated sidecars from the content directory, copies SVGs to the library,
copies existing WebP previews, detects multi-color assets, and writes assets.json.
Optionally processes a scenes directory and writes scenes.json.

Preview generation is handled separately by preview_catalog.py.  Run that first
(or independently) to ensure previews exist before running this script.

All file generation is done in a temporary directory first; outputs are then
copied over the final destinations (existing files are overwritten, no deletions).

Usage (assets only):
    python scripts/post_catalog.py \
        --content  content \
        --library  src/assets/library \
        --previews src/assets/previews \
        --output   src/assets/assets.json

Usage (assets + scenes):
    python scripts/post_catalog.py \
        --content       content \
        --library       src/assets/library \
        --previews      src/assets/previews \
        --output        src/assets/assets.json \
        --scenes        saves \
        --scenes-output src/assets/scenes.json \
        --scenes-dist   src/assets/scenes
"""

import argparse
import json
import shutil
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from xml.etree import ElementTree as ET

from _common import (
    FOLDER_SIDECAR,
    SECTION_NAMES,
    load_folder_sidecar,
    load_item_sidecar,
    publish_dir,
    publish_file,
    ValidationError,
)
from compile_svg_bundle import build_bundle


# ---------------------------------------------------------------------------
# Multi-color detection
# ---------------------------------------------------------------------------

def detect_multicolor(svg_path: Path) -> tuple[bool, list[dict]]:
    """
    Returns (is_multicolor, parts).

    A file is multi-color if the root <svg> (or a single top-level wrapper <g>)
    has at least two direct child <g id="..."> elements each containing at least
    one <path>, <rect>, or <circle>.
    """
    try:
        tree = ET.parse(str(svg_path))
        root = tree.getroot()
    except ET.ParseError:
        return False, []

    def tag(el) -> str:
        return el.tag.split("}")[-1] if "}" in el.tag else el.tag

    def has_shape(g_el) -> bool:
        for child in g_el:
            if tag(child) in ("path", "rect", "circle"):
                return True
        return False

    children = list(root)
    if len(children) == 1 and tag(children[0]) == "g":
        candidate_parent = children[0]
    else:
        candidate_parent = root

    parts = []
    for child in candidate_parent:
        if tag(child) == "g" and child.get("id") and has_shape(child):
            parts.append({"id": child.get("id"), "label": child.get("id")})

    if len(parts) >= 2:
        return True, parts
    return False, []


# ---------------------------------------------------------------------------
# Recursive folder builder
# ---------------------------------------------------------------------------

def build_folder(
    folder: Path,
    content_root: Path,
    tmp_library: Path,
    tmp_previews: Path,
    previews_root: Path,
    errors: list,
    stats: dict,
) -> dict | None:
    try:
        folder_meta = load_folder_sidecar(folder)
    except ValidationError as e:
        errors.append(str(e))
        return None

    items = []
    subfolders = []

    for svg in sorted(folder.glob("*.svg"), key=lambda p: p.name.lower()):
        try:
            item_meta = load_item_sidecar(svg)
        except ValidationError as e:
            errors.append(str(e))
            stats["errors"] += 1
            continue

        asset_id  = item_meta["id"]
        lib_dest  = tmp_library / f"{asset_id}.svg"
        prev_src  = previews_root / f"{asset_id}.webp"
        prev_dest = tmp_previews  / f"{asset_id}.webp"

        shutil.copy2(svg, lib_dest)

        # Copy existing preview; warn if missing but keep building
        if prev_src.exists():
            shutil.copy2(prev_src, prev_dest)
        else:
            errors.append(f"Missing preview (run preview_catalog.py): {prev_src}")
            stats["missing_previews"] += 1

        is_mc, mc_parts = detect_multicolor(svg)

        items.append({
            "id":          asset_id,
            "label":       item_meta["label"],
            "description": item_meta.get("description", ""),
            "author":      item_meta.get("author", ""),
            "tags":        item_meta.get("tags", []),
            "path":        f"library/{asset_id}.svg",
            "preview":     f"previews/{asset_id}.webp",
            "multiColor":  is_mc,
            "parts":       mc_parts,
        })
        stats["files"] += 1

    for sub in sorted(folder.iterdir(), key=lambda p: p.name.lower()):
        if sub.is_dir():
            sub_data = build_folder(
                sub, content_root, tmp_library, tmp_previews,
                previews_root, errors, stats,
            )
            if sub_data is not None:
                subfolders.append(sub_data)

    return {
        "id":          folder_meta["id"],
        "label":       folder_meta["label"],
        "description": folder_meta.get("description", ""),
        "author":      folder_meta.get("author", ""),
        "folders":     subfolders,
        "items":       items,
    }


# ---------------------------------------------------------------------------
# Asset catalogue builder
# ---------------------------------------------------------------------------

def build_assets(
    content: Path,
    library: Path,
    previews: Path,
    output: Path,
) -> bool:
    print("=== Asset catalogue ===")
    errors: list = []
    stats = {"files": 0, "missing_previews": 0, "errors": 0}

    tmp_root     = Path(tempfile.mkdtemp(prefix="laops_assets_"))
    tmp_library  = tmp_root / "library"
    tmp_previews = tmp_root / "previews"
    tmp_json     = tmp_root / "assets.json"

    tmp_library.mkdir()
    tmp_previews.mkdir()

    try:
        section_labels = {"objects": "Objects", "parts": "Parts", "multicolor": "Multi-Color"}
        sections = []

        for section_id in SECTION_NAMES:
            section_dir = content / section_id
            if not section_dir.is_dir():
                print(f"  skip section '{section_id}' (directory not found)")
                continue

            top_folders = []
            for folder in sorted(section_dir.iterdir(), key=lambda p: p.name.lower()):
                if not folder.is_dir():
                    continue
                result = build_folder(
                    folder, content, tmp_library, tmp_previews,
                    previews, errors, stats,
                )
                if result is not None:
                    top_folders.append(result)

            sections.append({
                "id":      section_id,
                "label":   section_labels[section_id],
                "folders": top_folders,
            })

        catalogue = {
            "version":   1,
            "generated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "sections":  sections,
        }
        tmp_json.write_text(json.dumps(catalogue, indent=2) + "\n", encoding="utf-8")

        publish_dir(tmp_library,  library)
        publish_dir(tmp_previews, previews)
        publish_file(tmp_json,    output)

    finally:
        shutil.rmtree(tmp_root, ignore_errors=True)

    print(f"  {stats['files']} SVG(s), {stats['missing_previews']} missing preview(s), {stats['errors']} error(s)")
    if errors:
        print("\nWarnings / Errors:")
        for e in errors:
            print(f"  {e}")

    return stats["errors"] == 0


# ---------------------------------------------------------------------------
# Scene catalogue builder
# ---------------------------------------------------------------------------

def build_scenes(
    scenes_root: Path,
    scenes_dist: Path,
    scenes_output: Path,
) -> bool:
    print("\n=== Scene catalogue ===")
    errors: list = []

    tmp_root = Path(tempfile.mkdtemp(prefix="laops_scenes_"))
    tmp_dist = tmp_root / "dist"
    tmp_json = tmp_root / "scenes.json"

    tmp_dist.mkdir()

    try:
        def process_folder(folder: Path) -> dict | None:
            try:
                folder_meta = load_folder_sidecar(folder)
            except ValidationError as e:
                errors.append(str(e))
                return None

            items = []
            subfolders = []

            for laops in sorted(folder.glob("*.laops"), key=lambda p: p.name.lower()):
                json_sidecar = laops.with_suffix(".json")
                webp_preview = laops.with_suffix(".webp")

                if not json_sidecar.exists():
                    errors.append(f"Missing scene sidecar: {json_sidecar}")
                    continue
                if not webp_preview.exists():
                    errors.append(f"Missing scene preview: {webp_preview}")
                    continue

                try:
                    meta = json.loads(json_sidecar.read_text(encoding="utf-8"))
                except Exception as e:
                    errors.append(f"Cannot parse {json_sidecar}: {e}")
                    continue

                if not meta.get("id"):
                    errors.append(f"Missing 'id' in {json_sidecar}")
                    continue
                if not meta.get("label"):
                    errors.append(f"Missing 'label' in {json_sidecar}")
                    continue

                scene_id   = meta["id"]
                dest_laops = tmp_dist / f"{scene_id}.laops"
                dest_webp  = tmp_dist / f"{scene_id}.webp"
                shutil.copy2(laops, dest_laops)
                shutil.copy2(webp_preview, dest_webp)

                items.append({
                    "id":          scene_id,
                    "label":       meta["label"],
                    "description": meta.get("description", ""),
                    "author":      meta.get("author", ""),
                    "tags":        meta.get("tags", []),
                    "path":        f"scenes/{scene_id}.laops",
                    "preview":     f"scenes/{scene_id}.webp",
                })

            for sub in sorted(folder.iterdir(), key=lambda p: p.name.lower()):
                if sub.is_dir():
                    sub_data = process_folder(sub)
                    if sub_data is not None:
                        subfolders.append(sub_data)

            return {
                "id":          folder_meta["id"],
                "label":       folder_meta["label"],
                "description": folder_meta.get("description", ""),
                "author":      folder_meta.get("author", ""),
                "folders":     subfolders,
                "items":       items,
            }

        top_folders = []
        for folder in sorted(scenes_root.iterdir(), key=lambda p: p.name.lower()):
            if not folder.is_dir():
                continue
            result = process_folder(folder)
            if result is not None:
                top_folders.append(result)

        catalogue = {
            "version":   1,
            "generated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "folders":   top_folders,
        }
        tmp_json.write_text(json.dumps(catalogue, indent=2) + "\n", encoding="utf-8")

        publish_dir(tmp_dist, scenes_dist)
        publish_file(tmp_json, scenes_output)

    finally:
        shutil.rmtree(tmp_root, ignore_errors=True)

    scene_count = sum(len(f["items"]) for f in top_folders)
    print(f"  {scene_count} scene(s) processed, {len(errors)} error(s)")
    if errors:
        print("\nErrors:")
        for e in errors:
            print(f"  {e}")

    return len(errors) == 0


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(description="Build the LAOPS asset and/or scene catalogue.")

    parser.add_argument("--content",  required=True, type=Path, help="Root content directory (contains objects/, parts/, multicolor/)")
    parser.add_argument("--library",  required=True, type=Path, help="Output directory for SVG copies")
    parser.add_argument("--previews", required=True, type=Path, help="Directory containing WebP previews (produced by preview_catalog.py)")
    parser.add_argument("--output",   required=True, type=Path, help="Output path for assets.json")

    parser.add_argument("--scenes",        type=Path, default=None, help="Root scenes/saves directory")
    parser.add_argument("--scenes-output", type=Path, default=None, help="Output path for scenes.json")
    parser.add_argument("--scenes-dist",   type=Path, default=None, help="Output directory for copied scene files")

    parser.add_argument("--bundle", type=Path, default=None, help="Output path for the compiled SVG bundle (library.pack)")

    args = parser.parse_args()

    scene_args = [args.scenes, args.scenes_output, args.scenes_dist]
    if any(a is not None for a in scene_args) and not all(a is not None for a in scene_args):
        sys.exit("ERROR: --scenes, --scenes-output, and --scenes-dist must all be provided together.")

    ok = build_assets(
        content  = args.content.resolve(),
        library  = args.library.resolve(),
        previews = args.previews.resolve(),
        output   = args.output.resolve(),
    )

    if args.scenes:
        ok_scenes = build_scenes(
            scenes_root   = args.scenes.resolve(),
            scenes_dist   = args.scenes_dist.resolve(),
            scenes_output = args.scenes_output.resolve(),
        )
        ok = ok and ok_scenes

    if args.bundle:
        try:
            build_bundle(
                library = args.library.resolve(),
                catalog = args.output.resolve(),
                output  = args.bundle.resolve(),
            )
        except Exception as e:
            print(f"\nBundle build failed: {e}")
            ok = False

    if not ok:
        sys.exit(1)

    print("\nCatalogue build complete.")


if __name__ == "__main__":
    main()
