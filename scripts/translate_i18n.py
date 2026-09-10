"""
translate_i18n.py — Auto-translate i18n files via a local Ollama AI.

Reads the canonical English source (translation.json), compares it against
en.json, and translates any missing or changed keys into every supported
language. Per-key source hashes are stored in each language file so only
keys whose English text actually changed are re-sent to the AI.

Usage:
    python scripts/translate_i18n.py
    python scripts/translate_i18n.py --force            # re-translate everything
    python scripts/translate_i18n.py --lang fr          # only French
    python scripts/translate_i18n.py --dry-run          # show what would change
    python scripts/translate_i18n.py --model qwen3.8:latest
    python scripts/translate_i18n.py --ollama-url http://localhost:11434/v1
"""

import argparse
import hashlib
import json
import re
import sys
from pathlib import Path

try:
    from openai import OpenAI
except ImportError:
    sys.exit("ERROR: missing dependency: openai\n  pip install openai")

ROOT = Path(__file__).resolve().parent.parent
I18N_DIR = ROOT / "src" / "assets" / "i18n"
SOURCE_FILE = I18N_DIR / "translation.json"
EN_FILE = I18N_DIR / "en.json"
SPOOKY_FILE = I18N_DIR / "spooky.json"

LANGUAGES = {
    "fr": "French",
    "de": "German",
    "es": "Spanish",
    "ru": "Russian",
    "it": "Italian",
    "da": "Danish",
    "fi": "Finnish",
    "el": "Greek",
    "hu": "Hungarian",
    "ga": "Irish",
    "pl": "Polish",
    "pt": "Portuguese",
    "sv": "Swedish",
}

_TOKEN_RE = re.compile(r"\{\{[^}]*\}\}|\{[^}]+\}")


# ---------------------------------------------------------------------------
# Nested <-> flat JSON helpers
# ---------------------------------------------------------------------------

def flatten(d: dict, prefix: str = "") -> dict:
    out = {}
    for k, v in d.items():
        full = f"{prefix}.{k}" if prefix else k
        if isinstance(v, dict):
            out.update(flatten(v, full))
        else:
            out[full] = v
    return out


def unflatten(d: dict) -> dict:
    out = {}
    for dotted, v in d.items():
        parts = dotted.split(".")
        cur = out
        for p in parts[:-1]:
            cur = cur.setdefault(p, {})
        cur[parts[-1]] = v
    return out


def load_flat(path: Path) -> dict:
    with path.open(encoding="utf-8") as f:
        return flatten(json.load(f))


def load_lang_file(path: Path) -> tuple[dict, dict]:
    """Return (flat key->label map, per-key source hashes) for a language file."""
    if not path.exists():
        return {}, {}
    raw = json.loads(path.read_text(encoding="utf-8"))
    hashes = dict(raw.pop("_hashes", {})) if isinstance(raw.get("_hashes"), dict) else {}
    hashes = {k: v for k, v in hashes.items() if isinstance(v, str)}
    return flatten(raw), hashes


def write_flat(path: Path, flat_map: dict, extra: dict | None = None) -> None:
    nested = unflatten(flat_map)
    if extra:
        nested.update(extra)
    with path.open("w", encoding="utf-8") as f:
        json.dump(nested, f, indent=2, ensure_ascii=False)
        f.write("\n")


def token_set(text: str) -> set:
    return set(_TOKEN_RE.findall(text))


def spookify(text: str) -> str:
    return f"\U0001f383 {text} \U0001f47b"


# ---------------------------------------------------------------------------
# AI translation
# ---------------------------------------------------------------------------

def make_client(base_url: str) -> "OpenAI":
    return OpenAI(base_url=base_url, api_key="ollama")


def extract_json(text: str) -> dict | None:
    text = text.strip()
    if text.startswith("```"):
        text = re.sub(r"^```[a-zA-Z]*\s*", "", text)
        text = re.sub(r"\s*```$", "", text)
    start = text.find("{")
    end = text.rfind("}")
    if start == -1 or end == -1 or end <= start:
        return None
    try:
        obj = json.loads(text[start:end + 1])
        return obj if isinstance(obj, dict) else None
    except json.JSONDecodeError:
        return None


def translate_single(client, model: str, english: str, lang_name: str) -> str | None:
    resp = client.chat.completions.create(
        model=model,
        messages=[
            {"role": "system", "content": (
                f"You are a professional UI translator. Translate the following UI label "
                f"from English to {lang_name}. "
                "Respond with ONLY the translated text. No quotes, no explanation. "
                "Keep it short — it is a UI label. Preserve any {{placeholder}} tokens exactly."
            )},
            {"role": "user", "content": english},
        ],
        temperature=0.2,
    )
    return resp.choices[0].message.content.strip().strip('"')


def translate_batch(client, model: str, pairs: list, lang_name: str) -> dict:
    """Translate many labels in one call. Returns {key: text} for what worked."""
    lines = "\n".join(f"{k}: {v}" for k, v in pairs)
    resp = client.chat.completions.create(
        model=model,
        messages=[
            {"role": "system", "content": (
                f"You are a professional UI translator. Translate the given English UI labels "
                f"to {lang_name}. Respond with ONLY a JSON object mapping each key to its "
                f"translated string. No markdown, no explanation. Keep labels short. "
                f"Preserve any {{placeholder}} tokens exactly as they appear."
            )},
            {"role": "user", "content": lines},
        ],
        temperature=0.2,
    )
    obj = extract_json(resp.choices[0].message.content) or {}
    out = {}
    for key, _ in pairs:
        val = obj.get(key)
        if isinstance(val, str) and val.strip():
            out[key] = val
    return out


def translate_keys(client, model: str, keys: list, source: dict, lang_name: str,
                   batch_size: int) -> dict:
    """Translate keys in AI batches; retry stragglers one by one."""
    result: dict[str, str] = {}
    todo = list(keys)
    while todo:
        chunk = todo[:batch_size]
        todo = todo[batch_size:]
        got = translate_batch(client, model, [(k, source[k]) for k in chunk], lang_name)
        failed = []
        for k in chunk:
            if k in got:
                src_tokens = token_set(source[k])
                got_tokens = token_set(got[k])
                if src_tokens <= got_tokens:
                    result[k] = got[k]
                else:
                    failed.append(k)
            else:
                failed.append(k)
        for k in failed:
            val = translate_single(client, model, source[k], lang_name)
            if val and token_set(source[k]) <= token_set(val):
                result[k] = val
            else:
                print(f"  !! could not get a valid translation for {k} — keeping current value")
    return result


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(description="Translate i18n files via Ollama.")
    parser.add_argument("--force", action="store_true", help="re-translate all keys")
    parser.add_argument("--lang", default=None, help="restrict to one language code")
    parser.add_argument("--dry-run", action="store_true", help="show what would change, write nothing")
    parser.add_argument("--model", default="qwen3.8:latest")
    parser.add_argument("--ollama-url", default="http://localhost:11434/v1")
    parser.add_argument("--batch-size", type=int, default=30)
    args = parser.parse_args()

    if not SOURCE_FILE.exists():
        sys.exit(f"ERROR: canonical source not found: {SOURCE_FILE}")
    if args.lang and args.lang not in LANGUAGES and args.lang != "spooky":
        sys.exit(f"ERROR: unknown language '{args.lang}' (supported: {', '.join(sorted(LANGUAGES | {'spooky'}))})")

    source = load_flat(SOURCE_FILE)
    print(f"Source: {len(source)} keys in {SOURCE_FILE.name}")

    # --- en.json sync -------------------------------------------------------
    en_flat = load_flat(EN_FILE) if EN_FILE.exists() else {}
    drifted = [k for k in source if en_flat.get(k) != source[k]]
    removed_from_en = [k for k in en_flat if k not in source]
    if drifted:
        print(f"WARNING: en.json drifted from translation.json on {len(drifted)} keys:")
        for k in drifted[:20]:
            print(f"  - {k}: en.json={en_flat.get(k)!r} source={source[k]!r}")
        if len(drifted) > 20:
            print(f"  ... and {len(drifted) - 20} more")
    if removed_from_en:
        print(f"WARNING: {len(removed_from_en)} keys in en.json are not in translation.json "
              f"(extra keys in language files will be dropped):")
        for k in removed_from_en[:20]:
            print(f"  - {k}")

    if not args.dry_run:
        en_changed = set(en_flat.keys()) != set(source.keys()) or bool(drifted)
        if en_changed:
            write_flat(EN_FILE, source)
            print(f"Wrote  {EN_FILE.name} (synced from translation.json)")

    # --- spooky (deterministic, no AI) --------------------------------------
    spooky_changed = False
    if args.lang in (None, "spooky"):
        existing_spooky = load_flat(SPOOKY_FILE) if SPOOKY_FILE.exists() else {}
        target_spooky = {k: spookify(v) for k, v in source.items()}
        spooky_changed = existing_spooky != target_spooky
        if args.dry_run:
            print(f"spooky: " + ("would be regenerated" if spooky_changed else "up to date"))
        elif spooky_changed:
            write_flat(SPOOKY_FILE, target_spooky)
            print(f"Wrote  {SPOOKY_FILE.name} ({len(target_spooky)} keys, deterministic transform)")

    if args.dry_run:
        # still report what would be translated, no AI calls
        if args.lang in LANGUAGES:
            langs = {args.lang: LANGUAGES[args.lang]}
        elif args.lang == "spooky":
            langs = {}
        else:
            langs = LANGUAGES
        for code, name in langs.items():
            path = I18N_DIR / f"{code}.json"
            lang_flat, hashes = load_lang_file(path)
            stale = [k for k in source
                     if args.force or k not in lang_flat
                     or hashes.get(k) != hashlib.sha1(source[k].encode()).hexdigest()
                     or k in drifted]
            extra = [k for k in lang_flat if k not in source]
            missing_file = " (file missing — will be created)" if not path.exists() else ""
            print(f"{code} ({name}): {len(stale)} keys to translate, "
                  f"{len(extra)} extra keys to drop{missing_file}")
        return

    # --- real translation ----------------------------------------------------
    if args.lang in LANGUAGES:
        langs = {args.lang: LANGUAGES[args.lang]}
    elif args.lang == "spooky":
        langs = {}
    else:
        langs = LANGUAGES
    client = make_client(args.ollama_url) if langs else None
    for code, name in langs.items():
        path = I18N_DIR / f"{code}.json"
        lang_flat, old_hashes = load_lang_file(path)

        stale = [k for k in source
                 if args.force or k not in lang_flat
                 or old_hashes.get(k) != hashlib.sha1(source[k].encode()).hexdigest()
                 or k in drifted]
        dropped = [k for k in lang_flat if k not in source]
        print(f"{code} ({name}): {len(stale)} stale, {len(dropped)} dropped")
        if not stale:
            continue

        print(f"  translating {len(stale)} keys with {args.model} ...")
        translated = translate_keys(client, args.model, stale, source, name, args.batch_size)
        for k, v in translated.items():
            lang_flat[k] = v
        for k in stale:
            old_hashes.pop(k, None)
        old_hashes.update({k: hashlib.sha1(source[k].encode()).hexdigest()
                           for k in source})
        for k in dropped:
            old_hashes.pop(k, None)
        write_flat(path, {k: v for k, v in lang_flat.items() if k not in dropped},
                   extra={"_hashes": old_hashes})
        done = len(translated)
        note = "" if done == len(stale) else f" ({len(stale) - done} failed)"
        print(f"  wrote {path.name} — {done} keys translated{note}")

    print("Done.")


if __name__ == "__main__":
    main()
