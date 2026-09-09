"""
review_content.py — Export/import asset sidecar data as a round-trip Markdown file.

Export: reads assets.json and all item sidecar JSONs, writes a single .md file
        with one section per asset, sorted by section → folder path → item name.
        Preview images are linked by relative path (pass --previews so the tool
        knows where to look).

Import: reads a previously exported .md file, parses every $KEY: line, and
        updates the matching item sidecar JSON on disk.  Unrecognised keys and
        non-prefixed lines (headings, images, blank lines) are ignored.
        Only $LABEL, $DESCRIPTION, $AUTHOR, and $TAG lines are writable;
        $ID and $PATH are read-only and used only for lookup.

Usage — export:
    python scripts/review_content.py export \
        --content  content \
        --assets   src/assets/assets.json \
        --previews src/assets/previews \
        --output   review.md

Usage — import:
    python scripts/review_content.py import \
        --content  content \
        --input    review.md
"""

import argparse
import json
import re
import sys
from pathlib import Path


# ---------------------------------------------------------------------------
# Markdown helpers
# ---------------------------------------------------------------------------

_PREFIX_RE = re.compile(r"^\$(\w+):\s*(.*)")


def _parse_prefixed_lines(lines: list[str]) -> dict:
    """
    Parse all $KEY: value lines from a list of strings.
    $TAG lines accumulate into a list; all other keys take the last value seen.
    """
    result: dict = {}
    for line in lines:
        m = _prefix_re_match(line)
        if not m:
            continue
        key, value = m
        if key == "TAG":
            result.setdefault("TAG", []).append(value)
        else:
            result[key] = value
    return result


def _prefix_re_match(line: str) -> tuple[str, str] | None:
    m = _PREFIX_RE.match(line.rstrip())
    if m:
        return m.group(1).upper(), m.group(2).strip()
    return None


# ---------------------------------------------------------------------------
# Export
# ---------------------------------------------------------------------------

def _relative_preview_path(preview_field: str, previews_root: Path, output_path: Path) -> str | None:
    """
    preview_field is the value stored in assets.json, e.g.
    "objects/Bodys/GORDON.webp".  The actual file lives at
    previews_root / preview_field.  Return a path relative to the
    directory that will contain the output .md file.
    """
    abs_preview = previews_root / preview_field
    if not abs_preview.exists():
        return None
    try:
        return str(abs_preview.relative_to(output_path.parent)).replace("\\", "/")
    except ValueError:
        # Fallback to absolute if the preview lives outside the output directory
        return str(abs_preview).replace("\\", "/")


def _collect_items(catalogue: dict) -> list[dict]:
    """
    Walk the catalogue and return a flat list of dicts, each containing:
      section_label, folder_path (list of folder labels), item (AssetItem dict)
    Sorted: section → folder path → item label.
    """
    records = []

    def walk_folders(folders, section_label, folder_path):
        for folder in sorted(folders, key=lambda f: f["label"].lower()):
            path = folder_path + [folder["label"]]
            for item in sorted(folder.get("items", []), key=lambda i: i["label"].lower()):
                records.append({
                    "section":     section_label,
                    "folder_path": path,
                    "item":        item,
                })
            walk_folders(folder.get("folders", []), section_label, path)

    for section in catalogue.get("sections", []):
        walk_folders(section.get("folders", []), section["label"], [])

    return records


def export_md(
    content: Path,
    assets_json: Path,
    previews: Path,
    output: Path,
) -> None:
    catalogue = json.loads(assets_json.read_text(encoding="utf-8"))
    records   = _collect_items(catalogue)

    lines = [
        "<!-- review_content.py export — edit $-prefixed lines and run import to apply -->",
        "",
    ]

    for rec in records:
        item        = rec["item"]
        breadcrumb  = " / ".join([rec["section"]] + rec["folder_path"])
        heading     = f"## {breadcrumb} / {item['label']}"

        lines.append(heading)
        lines.append("")
        lines.append(f"$ID: {item['id']}")
        lines.append(f"$PATH: {item.get('path', '')}")
        lines.append(f"$LABEL: {item.get('label', '')}")
        lines.append(f"$DESCRIPTION: {item.get('description', '')}")
        lines.append(f"$AUTHOR: {item.get('author', '')}")
        for tag in item.get("tags", []):
            lines.append(f"$TAG: {tag}")

        preview_rel = _relative_preview_path(item.get("preview", ""), previews, output)
        if preview_rel:
            lines.append("")
            lines.append(f"![{item['label']}]({preview_rel})")

        lines.append("")
        lines.append("---")
        lines.append("")

    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text("\n".join(lines), encoding="utf-8")
    print(f"Exported {len(records)} item(s) to {output}")


# ---------------------------------------------------------------------------
# Import
# ---------------------------------------------------------------------------

def _split_into_blocks(text: str) -> list[list[str]]:
    """
    Split the markdown into per-item blocks by `## ` headings.
    Returns a list of line-lists, one per block (heading line included).
    """
    blocks: list[list[str]] = []
    current: list[str] = []
    for line in text.splitlines():
        if line.startswith("## ") and current:
            blocks.append(current)
            current = [line]
        else:
            current.append(line)
    if current:
        blocks.append(current)
    return blocks


def _find_sidecar(item_id: str, content_root: Path) -> Path | None:
    """Search content_root recursively for a .json sidecar whose 'id' matches."""
    for json_path in content_root.rglob("*.json"):
        if json_path.name.startswith("_"):
            continue
        try:
            data = json.loads(json_path.read_text(encoding="utf-8"))
            if data.get("id") == item_id:
                return json_path
        except Exception:
            pass
    return None


def import_md(
    content: Path,
    input_path: Path,
) -> None:
    text   = input_path.read_text(encoding="utf-8")
    blocks = _split_into_blocks(text)

    updated = 0
    skipped = 0
    errors  = 0

    for block in blocks:
        parsed = _parse_prefixed_lines(block)
        item_id = parsed.get("ID", "").strip()
        if not item_id:
            continue

        sidecar = _find_sidecar(item_id, content)
        if sidecar is None:
            print(f"  warn: no sidecar found for $ID: {item_id} — skipping")
            skipped += 1
            continue

        try:
            data = json.loads(sidecar.read_text(encoding="utf-8"))
        except Exception as e:
            print(f"  error reading {sidecar}: {e}")
            errors += 1
            continue

        changed = False

        for key in ("LABEL", "DESCRIPTION", "AUTHOR"):
            json_key = key.lower()
            if key in parsed and parsed[key] != data.get(json_key, ""):
                data[json_key] = parsed[key]
                changed = True

        if "TAG" in parsed:
            new_tags = [t for t in parsed["TAG"] if t]
            if new_tags != data.get("tags", []):
                data["tags"] = new_tags
                changed = True
        else:
            # No $TAG lines at all → clear tags
            if data.get("tags"):
                data["tags"] = []
                changed = True

        if changed:
            sidecar.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
            print(f"  updated {sidecar}")
            updated += 1

    print(f"\nImport complete. {updated} updated, {skipped} skipped, {errors} error(s).")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(
        description="Export/import asset sidecar data as round-trip Markdown.",
    )
    sub = parser.add_subparsers(dest="command", required=True)

    exp = sub.add_parser("export", help="Write review.md from assets.json + sidecars")
    exp.add_argument("--content",  required=True, type=Path, help="Root content directory")
    exp.add_argument("--assets",   required=True, type=Path, help="Path to assets.json")
    exp.add_argument("--previews", required=True, type=Path, help="Directory containing .webp previews")
    exp.add_argument("--output",   required=True, type=Path, help="Output .md file path")

    imp = sub.add_parser("import", help="Apply edits from review.md back to sidecar JSONs")
    imp.add_argument("--content", required=True, type=Path, help="Root content directory")
    imp.add_argument("--input",   required=True, type=Path, help="The .md file to import")

    args = parser.parse_args()

    if args.command == "export":
        content  = args.content.resolve()
        assets   = args.assets.resolve()
        previews = args.previews.resolve()
        output   = args.output.resolve()

        if not content.is_dir():
            sys.exit(f"ERROR: --content not found: {content}")
        if not assets.exists():
            sys.exit(f"ERROR: --assets not found: {assets}")
        if not previews.is_dir():
            sys.exit(f"ERROR: --previews not found: {previews}")

        export_md(content, assets, previews, output)

    elif args.command == "import":
        content    = args.content.resolve()
        input_path = args.input.resolve()

        if not content.is_dir():
            sys.exit(f"ERROR: --content not found: {content}")
        if not input_path.exists():
            sys.exit(f"ERROR: --input not found: {input_path}")

        import_md(content, input_path)


if __name__ == "__main__":
    main()
