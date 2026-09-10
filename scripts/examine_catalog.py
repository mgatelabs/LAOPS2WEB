"""
examine_catalog.py — Auto-generate descriptions for catalog items and folders using AI.

Walks the content directory (same structure as post_catalog.py) and calls an LLM
(via OpenAI-compatible API, defaulting to Ollama) to generate descriptions for
any item or folder sidecar that has an empty description field.

After processing all items in a folder, generates a folder-level description
summarising what's inside and writes it to _folder.json.

Usage:
    python scripts/examine_catalog.py --content content

    # Use a specific Ollama model
    python scripts/examine_catalog.py --content content --model llava

    # Force re-generation even if descriptions already exist
    python scripts/examine_catalog.py --content content --force

    # Preview what would change without writing
    python scripts/examine_catalog.py --content content --dry-run

    # Point at a remote Ollama instance
    python scripts/examine_catalog.py --content content --ollama-url http://192.168.1.10:11434/v1
"""

import argparse
import base64
import json
import re
import sys
from pathlib import Path

try:
    from openai import OpenAI
except ImportError:
    sys.exit("ERROR: missing dependency: openai\n  pip install openai")

from _common import (
    FOLDER_SIDECAR,
    SECTION_NAMES,
    render_transparent_png,
)

# ---------------------------------------------------------------------------
# System prompts
# ---------------------------------------------------------------------------

SYSTEM_PROMPT = """\
You are a catalog assistant for a 2D scene-composition tool called LAOPS.

Your job is to write short, clear descriptions for SVG artwork items used as
scene props. The art style is inspired by South Park — flat, cartoonish,
deliberately simple 2D cutout characters and objects. Many assets come from
the Half-Life and Counter-Strike game universes (weapons, characters, equipment,
environments) rendered in that same South Park cartoon style.

 An image of the item's artwork may be attached to the message. If one is
 provided, look at it — the artwork is the ground truth for what the item is.
 If no image is attached, or if it doesn't match the label, fall back to the
 label and folder context.

 When given the name and folder context of an item, respond with a single short
 description sentence (under 20 words). Do not mention "SVG", "asset", "file",
 or "2D". Just describe what the thing IS, as if writing a prop label.

Examples:
  Item "AK47" in folder "weapons/rifles" → "An AK-47 assault rifle in cartoon South Park style."
  Item "Gordon Freeman" in folder "characters/half-life" → "Gordon Freeman in his HEV suit, drawn in flat cartoon style."
  Item "Barrel" in folder "props/industrial" → "A red explosive barrel, as seen in Half-Life."

Respond with ONLY the description sentence. No quotes, no preamble.
"""

FOLDER_SYSTEM_PROMPT = """\
You are a catalog assistant for LAOPS, a 2D scene-composition tool.

Given a list of item labels found inside a content folder, write a single short
summary sentence (under 25 words) describing the folder's general contents.
The art style is South Park-inspired cartoon. Content often comes from the
Half-Life and Counter-Strike universes.

Respond with ONLY the summary sentence.
"""


# ---------------------------------------------------------------------------
# AI helpers
# ---------------------------------------------------------------------------

def make_client(base_url: str, api_key: str) -> OpenAI:
    return OpenAI(base_url=base_url, api_key=api_key)


def is_thinking_model(model: str) -> bool:
    """
    Returns True for models that produce a reasoning/thinking trace before
    emitting content (Qwen3, DeepSeek-R1, etc.).  For these we need a
    higher token budget so the model can finish thinking and emit a content
    reply, OR we fall back to extracting the answer from the reasoning trace.
    """
    m = (model or "").lower()
    return any(k in m for k in ("qwen3", "qwen2.5", "deepseek-r1", "deepseek-r2", "r1", "thinking"))


def needs_no_think(model: str) -> bool:
    """
    /no_think suppresses the reasoning preamble in native Ollama Qwen3
    models (those served directly by Ollama, not via hf.co/ or llama.cpp).
    For hf.co/ GGUF models the token is just ignored — the model still
    thinks — so we only send it for plain Ollama-hosted Qwen3.
    """
    m = (model or "").lower()
    return "qwen3" in m and "hf.co/" not in m and "gguf" not in m


def _extract_reasoning(message) -> str:
    """Pull a non-empty reasoning field out of a chat response message, if any."""
    for attr in ("reasoning", "reasoning_content", "reasoning_details", "thinking"):
        try:
            v = getattr(message, attr, None)
        except AttributeError:
            v = None
        if not v:
            continue
        if isinstance(v, str):
            return v.strip()
        if isinstance(v, list) and v:
            return " ".join(
                str(getattr(item, "text", item)) for item in v
            ).strip()
    try:
        dumped = message.model_dump()
    except Exception:
        dumped = {}
    if isinstance(dumped, dict):
        for attr in ("reasoning", "reasoning_content", "thinking"):
            v = dumped.get(attr)
            if isinstance(v, str) and v.strip():
                return v.strip()
    return ""


def clean_description(raw: str, from_reasoning: bool = False) -> str:
    """
    Reduce a (possibly reasoning-heavy) reply to a single short description line.

    Normal case: the model returned one clean sentence in `content` - passes
    through untouched.

    Reasoning fallback (from_reasoning=True): the trace may be truncated when
    finish_reason=length.  We take the LAST complete sentence (ending in .!?)
    which is the model's conclusion, not the longest which may be mid-thought.
    """
    text = (raw or "").strip()
    if not text:
        return ""
    lines = []
    for line in text.splitlines():
        line = line.strip().strip("\"'“”").strip()
        if not line or line.startswith("/"):
            continue
        lines.append(line)
    if not lines:
        return ""
    joined = " ".join(lines)
    # Strip "Thoughts: ..." / "Answer: ..." prefixes if present
    joined = re.sub(
        r"^(?:Thoughts?\s*:|I\s+think(?:\s|:)|Answer\s*:\s*)",
        "", joined, flags=re.IGNORECASE,
    )
    sentences = [s.strip() for s in re.split(r"(?<=[.!?])\s+", joined) if s.strip()]
    if not sentences:
        return ""
    # Filter out pure chain-of-thought sentences
    candidates = [
        s for s in sentences
        if not re.search(r"(?:think|thinking|okay|let me|so the|therefore)", s, re.IGNORECASE)
    ] or sentences

    if from_reasoning:
        # Reasoning traces are often cut mid-thought (finish_reason=length).
        # The last COMPLETE sentence is almost always the model's conclusion.
        result = candidates[-1]
    elif len(candidates) == 1 or len(joined.split()) <= 30:
        result = candidates[0]
    else:
        result = max(candidates, key=len)

    # Keep it label-sized (the prompt asks for < 20 words)
    words = result.split()
    if len(words) > 25:
        result = " ".join(words[:25]).rstrip(",;: and or")
    return result

def print_response(content: str, response, indent: str = "    ") -> None:
    """Print the model's response in a box so it's impossible to miss.

    Uses ASCII box characters so it renders cleanly on any console
    encoding (Windows cp1252, UTF-8, ...).
    """
    bar = indent + "+" + "-" * 58
    mid = indent + "|"
    end = indent + "+" + "-" * 58
    if not content.strip():
        print(bar)
        print(mid + " !! EMPTY RESPONSE - model returned nothing")
        print(end)
        # Dump the full message so we can see where the text actually went
        # (e.g. a `reasoning` field on thinking models).
        msg = response.choices[0].message
        try:
            extra = {k: v for k, v in msg.model_dump().items()
                     if k != "role" and v not in (None, "", [])}
        except Exception:
            extra = vars(msg)
        if extra:
            print(indent + "raw message fields (non-empty):")
            for k, v in extra.items():
                print(indent + f"  {k}: {v!r}")
    else:
        print(bar)
        for line in content.rstrip("\n").splitlines() or [""]:
            print(mid + " " + line)
        print(end)
    detail = f"finish_reason={getattr(response.choices[0], 'finish_reason', '?')}"
    if response.usage:
        detail += (
            f"  tokens: prompt={response.usage.prompt_tokens} "
            f"completion={response.usage.completion_tokens}"
        )
    print(indent + detail)


def describe_item(
    client: OpenAI,
    model: str,
    label: str,
    folder_path: str,
    verbose: bool = False,
    svg_path: Path | None = None,
) -> str:
    no_think  = needs_no_think(model)
    thinking  = is_thinking_model(model)
    user_msg  = f'Item label: "{label}"\nFolder path: {folder_path}'
    if no_think:
        user_msg += "\n/no_think"
    user_content: list[dict] = [{"type": "text", "text": user_msg}]
    sent_image = False
    if svg_path is not None and svg_path.exists():
        try:
            png_bytes = render_transparent_png(svg_path)
            b64 = base64.b64encode(png_bytes).decode("ascii")
            user_content.append(
                {
                    "type": "image_url",
                    "image_url": {"url": f"data:image/png;base64,{b64}"},
                }
            )
            sent_image = True
        except Exception as e:
            if verbose:
                print(f"    [verb] ! could not render {svg_path.name} to PNG: {e} - sending text only")
    if verbose:
        hint = " (thinking — /no_think sent)" if no_think else (" (thinking model)" if thinking else "")
        print(f"    [verb] → model: {model}{hint}")
        print(f"    [verb] → system prompt:\n{SYSTEM_PROMPT}")
        print(f"    [verb] → user message:\n{user_msg}")
        if sent_image:
            print(f"    [verb] → image: {svg_path.name} → PNG {len(png_bytes)} bytes (transparent, base64)")
    # Thinking models need headroom to finish reasoning before emitting content
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


def describe_folder(
    client: OpenAI,
    model: str,
    folder_label: str,
    folder_path: str,
    item_labels: list[str],
    verbose: bool = False,
) -> str:
    items_list = ", ".join(f'"{l}"' for l in item_labels[:30])  # cap context at 30 items
    user_msg = (
        f'Folder label: "{folder_label}"\n'
        f'Folder path: {folder_path}\n'
        f'Items inside: {items_list}'
    )
    no_think = needs_no_think(model)
    thinking  = is_thinking_model(model)
    if no_think:
        user_msg += "\n/no_think"
    if verbose:
        hint = " (thinking — /no_think sent)" if no_think else (" (thinking model)" if thinking else "")
        print(f"    [verb] → model: {model}{hint}")
        print(f"    [verb] → system prompt:\n{FOLDER_SYSTEM_PROMPT}")
        print(f"    [verb] → user message:\n{user_msg}")
    max_tok = 8192 if thinking else 512
    response = client.chat.completions.create(
        model=model,
        messages=[
            {"role": "system", "content": FOLDER_SYSTEM_PROMPT},
            {"role": "user",   "content": user_msg},
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
    content_root: Path,
    client: OpenAI,
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

    folder_rel = folder.relative_to(content_root).as_posix()
    folder_label = folder_meta.get("label", folder.name)
    item_labels_collected: list[str] = []

    # --- Process each SVG item in this folder ---
    for svg in sorted(folder.glob("*.svg"), key=lambda p: p.name.lower()):
        sidecar_path = svg.with_suffix(".json")
        item_meta = read_sidecar(sidecar_path)

        if not item_meta.get("id") or not item_meta.get("label"):
            print(f"    skip {svg.name} — missing id or label in sidecar")
            continue

        label = item_meta["label"]
        item_labels_collected.append(label)

        existing_desc = item_meta.get("description", "").strip()
        if existing_desc and not force:
            continue

        print(f"  {folder_rel}/{svg.stem}  ({label})")
        try:
            desc = describe_item(client, model, label, folder_rel, verbose, svg_path=svg)
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
            process_folder(sub, content_root, client, model, force, dry_run, verbose, stats)

    # --- Update folder description after all items are known ---
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
        description="Auto-generate descriptions for catalog items/folders using an LLM."
    )
    parser.add_argument(
        "--content", required=True, type=Path,
        help="Root content directory (contains objects/, parts/, multicolor/)",
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

    content = args.content.resolve()
    if not content.is_dir():
        sys.exit(f"ERROR: content directory not found: {content}")

    client = make_client(args.ollama_url, args.api_key)

    stats = {"items_updated": 0, "folders_updated": 0, "errors": 0}

    if args.dry_run:
        print("[DRY RUN — no files will be written]\n")

    for section_name in SECTION_NAMES:
        section_dir = content / section_name
        if not section_dir.is_dir():
            continue

        print(f"\n=== Section: {section_name} ===")
        for folder in sorted(section_dir.iterdir(), key=lambda p: p.name.lower()):
            if folder.is_dir():
                process_folder(
                    folder, content, client,
                    args.model, args.force, args.dry_run, args.verbose, stats,
                )

    print(
        f"\nDone. {stats['items_updated']} item(s) updated, "
        f"{stats['folders_updated']} folder(s) updated, "
        f"{stats['errors']} error(s)."
    )
    if stats["errors"]:
        sys.exit(1)


if __name__ == "__main__":
    main()
