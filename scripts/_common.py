"""
_common.py — Shared helpers for the LAOPS asset pipeline scripts.

Imported by post_catalog.py, preview_catalog.py, and review_content.py.
Not intended to be run directly.
"""

import io
import json
import os
import re
import shutil
import tempfile
from pathlib import Path

try:
    import cairosvg
except ImportError:
    cairosvg = None

try:
    from PIL import Image
except ImportError:
    Image = None


FOLDER_SIDECAR = "_folder.json"
INDEX_FILE     = "_index.json"
SECTION_NAMES  = ["objects", "parts", "multicolor"]


# ---------------------------------------------------------------------------
# Dependency check
# ---------------------------------------------------------------------------

def check_deps() -> None:
    import sys
    missing = []
    if cairosvg is None:
        missing.append("cairosvg")
    if Image is None:
        missing.append("Pillow")
    if missing:
        sys.exit(f"ERROR: missing dependencies: {', '.join(missing)}\n  pip install {' '.join(missing)}")


# ---------------------------------------------------------------------------
# Index helpers  (content/_index.json)
# ---------------------------------------------------------------------------

def load_index(content_root: Path) -> dict:
    path = content_root / INDEX_FILE
    if path.exists():
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            return {}
    return {}


def save_index(content_root: Path, index: dict) -> None:
    path = content_root / INDEX_FILE
    path.write_text(json.dumps(index, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def _mtime(path: Path) -> float:
    try:
        return path.stat().st_mtime
    except OSError:
        return 0.0


def preview_is_fresh(asset_id: str, svg: Path, sidecar: Path, index: dict) -> bool:
    """True if neither the SVG nor its sidecar has changed since the index entry was written."""
    entry = index.get(asset_id)
    if not entry:
        return False
    return (
        entry.get("svgMtime")  == _mtime(svg)
        and entry.get("jsonMtime") == _mtime(sidecar)
    )


def update_index_entry(asset_id: str, svg: Path, sidecar: Path, index: dict) -> None:
    index[asset_id] = {
        "svgMtime":  _mtime(svg),
        "jsonMtime": _mtime(sidecar),
    }


# ---------------------------------------------------------------------------
# SVG sanitisation
# ---------------------------------------------------------------------------

_DOC_TYPE_RE   = re.compile(r"<!DOCTYPE\b", re.IGNORECASE)
_ENTITY_DEF_RE = re.compile(r"<!ENTITY\s+(\w+)\s+(?P<val>\"[^\"]*\"|'[^']*')", re.IGNORECASE)
_ENTITY_USE_RE = re.compile(r"&(\w+);")


def _doctype_end(text: str, start: int) -> int | None:
    i = start
    n = len(text)
    while i < n:
        if text[i] == "[":
            depth = 1
            i += 1
            while i < n and depth:
                if text[i] == "[":
                    depth += 1
                elif text[i] == "]":
                    depth -= 1
                i += 1
        elif text[i] == ">":
            return i + 1
        else:
            i += 1
    return None


def sanitize_svg(src: Path) -> Path:
    """
    Write a DOCTYPE-stripped copy of *src* to a temp file and return its path.

    Illustrator exports include a DOCTYPE with internal <!ENTITY> declarations.
    lxml (cairosvg) rejects entity declarations outright, so we strip the block
    and substitute every &name; reference with its declared value.
    """
    text = src.read_text(encoding="utf-8")
    head = _DOC_TYPE_RE.search(text)
    if head:
        end = _doctype_end(text, head.start())
        if end is not None:
            block = text[head.start():end]
            entities = {}
            for name, raw in _ENTITY_DEF_RE.findall(block):
                entities[name] = raw[1:-1]
            text = text[:head.start()] + text[end:]
            if entities:
                def sub(match: re.Match) -> str:
                    return entities.get(match.group(1), "")
                text = _ENTITY_USE_RE.sub(sub, text)
    fd, tmp_name = tempfile.mkstemp(suffix=".svg", prefix="laops_svg_")
    os.close(fd)
    tmp = Path(tmp_name)
    tmp.write_text(text, encoding="utf-8")
    return tmp


# ---------------------------------------------------------------------------
# Preview rendering
# ---------------------------------------------------------------------------

def make_checkerboard(size: int = 128, tile: int = 8) -> "Image.Image":
    color_a = (204, 204, 204)
    color_b = (136, 136, 136)
    img = Image.new("RGB", (size, size))
    pixels = img.load()
    for y in range(size):
        for x in range(size):
            even = ((x // tile) + (y // tile)) % 2 == 0
            pixels[x, y] = color_a if even else color_b
    return img


def render_preview(svg_path: Path, out_path: Path, size: int = 128, pad: int = 4) -> None:
    """Render *svg_path* as a WebP thumbnail at *out_path* on a checkerboard background."""
    inner = size - pad * 2

    clean = sanitize_svg(svg_path)
    try:
        png_bytes = cairosvg.svg2png(
            url=str(clean),
            output_width=inner,
            output_height=inner,
            background_color=None,
        )
    finally:
        clean.unlink(missing_ok=True)

    svg_img = Image.open(io.BytesIO(png_bytes)).convert("RGBA")
    svg_img.thumbnail((inner, inner), Image.LANCZOS)

    bg = make_checkerboard(size).convert("RGBA")
    offset_x = pad + (inner - svg_img.width)  // 2
    offset_y = pad + (inner - svg_img.height) // 2
    bg.alpha_composite(svg_img, dest=(offset_x, offset_y))

    out_path.parent.mkdir(parents=True, exist_ok=True)
    bg.convert("RGB").save(str(out_path), "WEBP", quality=90)


# ---------------------------------------------------------------------------
# Sidecar validation
# ---------------------------------------------------------------------------

class ValidationError(Exception):
    pass


def load_folder_sidecar(folder: Path) -> dict:
    path = folder / FOLDER_SIDECAR
    if not path.exists():
        raise ValidationError(f"Missing _folder.json: {folder}")
    data = json.loads(path.read_text(encoding="utf-8"))
    if not data.get("id"):
        raise ValidationError(f"Missing 'id' in {path}")
    if not data.get("label"):
        raise ValidationError(f"Missing 'label' in {path}")
    return data


def load_item_sidecar(svg_path: Path) -> dict:
    path = svg_path.with_suffix(".json")
    if not path.exists():
        raise ValidationError(f"Missing sidecar: {path}")
    data = json.loads(path.read_text(encoding="utf-8"))
    if not data.get("id"):
        raise ValidationError(f"Missing 'id' in {path}")
    if not data.get("label"):
        raise ValidationError(f"Missing 'label' in {path}")
    return data


# ---------------------------------------------------------------------------
# Temp-then-publish helpers
# ---------------------------------------------------------------------------

def publish_dir(src: Path, dst: Path) -> None:
    """Copy every file from *src* tree into *dst*, overwriting existing files."""
    for src_file in src.rglob("*"):
        if src_file.is_file():
            rel = src_file.relative_to(src)
            dst_file = dst / rel
            dst_file.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(src_file, dst_file)


def publish_file(src: Path, dst: Path) -> None:
    dst.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(src, dst)
