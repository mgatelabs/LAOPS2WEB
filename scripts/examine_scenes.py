"""
examine_scenes.py — Auto-generate descriptions for scene items and folders using AI.

Walks the saves directory (same structure as post_catalog.py --scenes) and
calls an LLM (via OpenAI-compatible API, defaulting to Ollama) to generate
descriptions for any scene sidecar that has an empty description field.

When a preview image exists for a scene (`.png` preferred over `.webp`), it
is resized to <= 512 px on the long edge and attached to the AI message so
the model can see the scene.

After processing all scenes in a folder, generates a folder-level description
summarising what's inside and writes it to _folder.json (same as
examine_catalog.py).

Usage:
    python scripts/examine_scenes.py --saves saves

    # Use a specific Ollama model
    python scripts/examine_scenes.py --saves saves --model llava

    # Force re-generation even if descriptions already exist
    python scripts/examine_scenes.py --saves saves --force

    # Preview what would change without writing
    python scripts/examine_scenes.py --saves saves --dry-run

    # Point at a remote Ollama instance
    python scripts/examine_scenes.py --saves saves --ollama-url http://192.168.1.10:11434/v1

Dependencies:
    pip install openai Pillow
"""

import argparse
import base64
import io
import json
import sys
from pathlib import Path

try:
    from PIL import Image
except ImportError:
    Image = None

from _common import FOLDER_SIDECAR
from examine_catalog import (
    _extract_reasoning,
    clean_description,
    describe_folder,
    is_thinking_model,
    make_client,
    needs_no_think,
    print_response,
)


# ---------------------------------------------------------------------------
# System prompt (scene-specific)
# ---------------------------------------------------------------------------

SYSTEM_PROMPT = """\
You are a catalog assistant for LAOPS, a 2D scene-composition tool.

Your job is to write short descriptions for built-in scene presets.
Scenes are composed of South Park-style cartoon assets from Half-Life
and Counter-Strike universes arranged on a canvas.

An image of the scene may be attached. If one is provided, use it as
the primary source. Describe what the scene depicts — the setting,
the characters or objects present, and the general mood or action.

Respond with a single sentence under 30 words.
"""


# ---------------------------------------------------------------------------
# Scene image preparation
# ---------------------------------------------------------------------------

def prepare_scene_image(image_path: Path, max_edge: int = 512) -> bytes | None:
    """
    Load a scene preview (.png preferred over .webp), fit it to a square
    canvas of at most *max_edge* px on the long edge, and return it as PNG
    bytes ready for base64 encoding.  Returns None when Pillow is missing
    or the image cannot be read — callers treat images as optional.
    """
    if Image is None:
        return None
    try:
        img = Image.open(str(image_path)).convert("RGBA")
        img.thumbnail((max_edge, max_edge), Image.LANCZOS)
        buf = io.BytesIO()
        img.save(buf, "PNG")
        return buf.getvalue()
    except Exception:
        return None


def find_scene_image(stem_path: Path) -> Path | None:
    """Prefer the .png (source of truth), fall back to the .webp preview."""
    png, webp = stem_path.with_suffix(".png"), stem_path.with_suffix(".webp")
    if png.exists():
        return png
    if webp.exists():
        return webp
    return None


# ---------------------------------------------------------------------------
# AI description for a single scene
# ---------------------------------------------------------------------------

def describe_scene(
    client,
    model: str,
    label: str,
    folder_path: str,
    tags: list[str],
    image_bytes: bytes | None,
    verbose: bool = False,
) -> str:
    no_think = needs_no_think(model)
    thinking = is_thinking_model(model)
    user_msg = f'Scene label: "{label}"\nFolder path: {folder_path}'
    if tags:
        user_msg += "\nTags: " + ", ".join(tags)
    if no_think:
        user_msg += "\n/no_think"
    user_content: list[dict] = [{"type": "text", "text": user_msg}]
    sent_image = False
    if image_bytes:
        b64 = base64.b64encode(image_bytes).decode("ascii")
        user_content.append(
            {
                "type": "image_url",
                "image_url": {"url": f"data:image/png;base64,{b64}"},
            }
        )
        sent_image = True
    if verbose:
        hint = " (thinking — /no_think sent)" if no_think else (" (thinking model)" if thinking else "")
        print(f"    [verb] → model: {model}{hint}")
        print(f"    [verb] → system prompt:\n{SYSTEM_PROMPT}")
        print(f"    [verb] → user message:\n{user_msg}")
        if sent_image:
            print(f"    [verb] → image: PNG {len(image_bytes)} bytes (base64)")
        else:
            print("    [verb] → image: none — text only")
    max_tok = 8192 if thinking else 512
    response = client.chat.completions.create(
        model=model,
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user",   "content": user_content},
        ],
        max_tokens=max_tok,
        temperature=0.4,
    )
    raw_content = response.choices[0].message.content or ""
    if verbose:
        print_response(raw_content, response)
    if raw_content.strip():
        return clean_description(raw_content)
    reason = _extract_reasoning(response.choices[0].message)
    if verbose:
        print("    [verb] !! content empty — extracting from reasoning trace")
    return clean_description(reason, from_reasoning=True)


# ---------------------------------------------------------------------------
# Sidecar read / write
# ---------------------------------------------------------------------------

def read_sidecar(path: Path) -> dict:
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {}


def write_sidecar(path: Path, data: dict, dry_run: bool) -> None:
    text = json.dumps(data, indent=2, ensure_ascii=False) + "\n"
    if dry_run:
        print(f"    [dry-run] would write {path.name}")
    else:
        path.write_text(text, encoding="utf-8")


# ---------------------------------------------------------------------------
# Recursive folder processor
# ---------------------------------------------------------------------------

def process_folder(
    folder: Path,
    saves_root: Path,
    client,
    model: str,
    force: bool,
    dry_run: bool,
    verbose: bool,
    stats: dict,
) -> None:
    folder_sidecar_path = folder / FOLDER_SIDECAR
    folder_meta = read_sidecar(folder_sidecar_path)

    if not folder_meta.get("id") or not folder_meta.get("label"):
        print(f"  skip {folder} — missing id or label in _folder.json")
        return

    folder_rel = folder.relative_to(saves_root).as_posix()
    folder_label = folder_meta.get("label", folder.name)
    item_labels_collected: list[str] = []

    # --- Process each .laops scene in this folder ---
    for laops in sorted(folder.glob("*.laops"), key=lambda p: p.name.lower()):
        sidecar_path = laops.with_suffix(".json")
        item_meta = read_sidecar(sidecar_path)

        if not item_meta.get("id") or not item_meta.get("label"):
            print(f"    skip {laops.name} — missing id or label in sidecar")
            continue

        label = item_meta["label"]
        item_labels_collected.append(label)

        existing_desc = item_meta.get("description", "").strip()
        if existing_desc and not force:
            continue

        image_path = find_scene_image(laops)
        image_bytes = prepare_scene_image(image_path) if image_path else None
        if image_path and image_bytes is None and verbose:
            print(f"    [verb] ! could not load {image_path.name} — sending text only")

        print(f"  {folder_rel}/{laops.stem}  ({label})")
        try:
            desc = describe_scene(
                client, model, label, folder_rel,
                item_meta.get("tags") or [], image_bytes, verbose,
            )
        except Exception as e:
            print(f"    ERROR: {e}")
            stats["errors"] += 1
            continue

        if desc:
            print(f"    → {desc}")
        else:
            print("    → !! EMPTY - model returned nothing")
        item_meta["description"] = desc
        write_sidecar(sidecar_path, item_meta, dry_run)
        stats["items_updated"] += 1

    # --- Recurse into subfolders ---
    for sub in sorted(folder.iterdir(), key=lambda p: p.name.lower()):
        if sub.is_dir():
            process_folder(sub, saves_root, client, model, force, dry_run, verbose, stats)

    # --- Update folder description after all scenes are known ---
    if not item_labels_collected:
        return

    existing_folder_desc = folder_meta.get("description", "").strip()
    if existing_folder_desc and not force:
        return

    print(f"  folder: {folder_rel}  ({folder_label})")
    try:
        folder_desc = describe_folder(
            client, model, folder_label, folder_rel, item_labels_collected, verbose
        )
    except Exception as e:
        print(f"    ERROR generating folder description: {e}")
        stats["errors"] += 1
        return

    print(f"    → {folder_desc}")
    folder_meta["description"] = folder_desc
    write_sidecar(folder_sidecar_path, folder_meta, dry_run)
    stats["folders_updated"] += 1


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    if hasattr(sys.stdout, "reconfigure"):
        try:
            sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        except (ValueError, OSError):
            pass
    parser = argparse.ArgumentParser(
        description="Auto-generate descriptions for scene items/folders using an LLM."
    )
    parser.add_argument(
        "--saves", required=True, type=Path,
        help="Saves root directory (contains scene folders)",
    )
    parser.add_argument(
        "--ollama-url", default="http://localhost:11434/v1",
        help="OpenAI-compatible API base URL (default: http://localhost:11434/v1)",
    )
    parser.add_argument(
        "--api-key", default="ollama",
        help="API key — Ollama ignores this; set for real OpenAI use (default: ollama)",
    )
    parser.add_argument(
        "--model", default="llama3",
        help="Model name to use (default: llama3)",
    )
    parser.add_argument(
        "--force", action="store_true",
        help="Re-generate descriptions even if they already exist",
    )
    parser.add_argument(
        "--dry-run", action="store_true",
        help="Print what would change without writing any files",
    )
    parser.add_argument(
        "--verbose", action="store_true",
        help="Print the full request (prompts, messages) and response for each LLM call",
    )
    args = parser.parse_args()

    saves = args.saves.resolve()
    if not saves.is_dir():
        sys.exit(f"ERROR: saves directory not found: {saves}")

    if Image is None:
        print("WARNING: Pillow not installed — scenes will be described from text only.")

    client = make_client(args.ollama_url, args.api_key)

    stats = {"items_updated": 0, "folders_updated": 0, "errors": 0}

    if args.dry_run:
        print("[DRY RUN — no files will be written]\n")

    for folder in sorted(saves.iterdir(), key=lambda p: p.name.lower()):
        if folder.is_dir():
            process_folder(
                folder, saves, client,
                args.model, args.force, args.dry_run, args.verbose, stats,
            )

    print(
        f"\nDone. {stats['items_updated']} scene(s) updated, "
        f"{stats['folders_updated']} folder(s) updated, "
        f"{stats['errors']} error(s)."
    )
    if stats["errors"]:
        sys.exit(1)


if __name__ == "__main__":
    main()
