"""
compile_svg_bundle.py — Compile all library SVGs into a single pack file.

Reads the asset catalogue (assets.json) and the SVG copies in the library
directory, minifies each SVG, and writes one record per line to library.pack:

    {ASSET_ID};{MINIFIED_SVG_CONTENT}

The SVG content never contains newlines after minification, so a single \n
reliably terminates each record.  The first ';' separates the asset ID from
the content.

Note: before stripping the DOCTYPE, entity references defined in its internal
subset (Adobe Illustrator's &ns_svg; / &ns_xlink;) are expanded to their literal
values so the minified SVG remains parseable.  xlink:href is rewritten to href
and the xmlns:xlink declaration is dropped only when no other xlink: attribute
remains.

Usage:
    python scripts/compile_svg_bundle.py \
        --library  src/assets/library \
        --catalog  src/assets/assets.json \
        --output   src/assets/library.pack

Also importable by post_catalog.py via build_bundle().
"""

import argparse
import json
import re
import sys
from pathlib import Path

XML_DECL_RE = re.compile(r'<\?xml[^?]*\?>', re.DOTALL)
# DOCTYPE with (optional) internal subset: the `[...]` part is consumed in full so
# entity-definition lines ending in `>` are not misread as the declaration terminator.
DOCTYPE_RE = re.compile(r'<!DOCTYPE\b[^[]*(?:\[[^\]]*\])??>', re.DOTALL)
COMMENT_RE = re.compile(r'<!--.*?-->', re.DOTALL)
ENTITY_DEF_RE = re.compile(r'<!ENTITY\s+(\w+)\s+"([^"]*)"')
ANY_ENTITY_REF_RE = re.compile(r'&([A-Za-z_][A-Za-z0-9_]*);')
XLINK_HREF_RE = re.compile(r'<([^>]*?)(\bxlink:href\s*=\s*")([^"]*)(")')
XLINK_ANY_RE = re.compile(r'\bxlink:[A-Za-z]+')


def _internal_subset_entities(doctype: str) -> dict[str, str]:
    """Return {entity name: value} from the DOCTYPE internal subset, else {}."""
    if not doctype:
        return {}
    m = re.search(r'\[[^\]]*\]', doctype, re.DOTALL)
    if not m:
        return {}
    return {name: value for name, value in ENTITY_DEF_RE.findall(m.group(0))}


def minify_svg(text: str) -> str:
    # 0. Pull entity definitions out of the DOCTYPE internal subset.  Adobe-
    #    Illustrator SVGs reference &ns_svg; / &ns_xlink; from a DOCTYPE subset, so
    #    stripping the DOCTYPE would leave dangling entity references and make the
    #    fragment unparseable.  Expand those references to their literal values
    #    first, so the output stays valid after the DOCTYPE is removed.
    doctype_m = DOCTYPE_RE.search(text)
    entities = _internal_subset_entities(doctype_m.group(0)) if doctype_m else {}
    if entities:
        text = ANY_ENTITY_REF_RE.sub(
            lambda m: entities.get(m.group(1), m.group(0)), text
        )

    # 1. Strip XML declaration, 2. DOCTYPE, 3. HTML/XML comments.
    text = XML_DECL_RE.sub('', text)
    text = DOCTYPE_RE.sub('', text)
    text = COMMENT_RE.sub('', text)

    # 4. Modernise xlink: point the legacy xlink:href at SVG2 href, then drop the
    #    now-unused xmlns:xlink declaration (only if no other xlink: attr remains).
    text = XLINK_HREF_RE.sub(r'<\1href="\3\4', text)
    if not XLINK_ANY_RE.search(text):
        text = re.sub(r'\sxmlns:xlink\s*=\s*"[^"]*"', '', text)

    # 5. Normalise whitespace.  6. Collapse space runs between tags.
    text = text.replace('\r\n', ' ').replace('\r', ' ').replace('\n', ' ')
    text = text.replace('\t', ' ')
    text = re.sub(r' {2,}', ' ', text)
    text = re.sub(r'>\s+<', '><', text)
    return text.strip()


def walk_folders(folders: list, library: Path, records: list) -> None:
    for folder in folders:
        for item in folder.get('items', []):
            svg_path = library / f"{item['id']}.svg"
            if svg_path.exists():
                raw = svg_path.read_text(encoding='utf-8', errors='replace')
                records.append((item['id'], minify_svg(raw)))
        walk_folders(folder.get('folders', []), library, records)


def build_bundle(library: Path, catalog: Path, output: Path) -> int:
    assets = json.loads(catalog.read_text(encoding='utf-8'))
    records: list[tuple[str, str]] = []
    for section in assets.get('sections', []):
        walk_folders(section.get('folders', []), library, records)
    with output.open('w', encoding='utf-8', newline='\n') as f:
        for asset_id, content in records:
            f.write(f'{asset_id};{content}\n')
    print(f"Wrote {len(records)} records -> {output}")
    return len(records)


def main() -> None:
    parser = argparse.ArgumentParser(description="Compile library SVGs into a single bundle pack file.")
    parser.add_argument("--library", required=True, type=Path, help="Directory containing {asset_id}.svg files")
    parser.add_argument("--catalog", required=True, type=Path, help="Path to assets.json")
    parser.add_argument("--output",  required=True, type=Path, help="Output path for library.pack")

    args = parser.parse_args()

    count = build_bundle(
        library = args.library.resolve(),
        catalog = args.catalog.resolve(),
        output  = args.output.resolve(),
    )
    if count == 0:
        sys.exit("ERROR: no SVG records found; check --library and --catalog paths.")


if __name__ == "__main__":
    main()
