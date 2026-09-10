# LAOPS 4 Web

Angular 17 scene-composition tool. Users place SVG objects on a canvas, transform and layer them, and save/export.

## Live App

**[https://mgatelabs.github.io/LAOPS2WEB/](https://mgatelabs.github.io/LAOPS2WEB/)**

---

## Development server

Run `ng serve` for a dev server. Navigate to `http://localhost:4200/`. The application will automatically reload if you change any of the source files.

## Build

Run `ng build` to build the project. The build artifacts will be stored in the `dist/` directory.

---

## Asset pipeline scripts

The scripts in `scripts/` manage the asset catalogue. They require **Python 3.11+**.

### Installing Python dependencies

All script dependencies are listed in `scripts/requirements.txt`.

**Recommended: install into a virtual environment**

```bash
python -m venv .venv
# Windows
.venv\Scripts\activate
# macOS / Linux
source .venv/bin/activate

pip install -r scripts/requirements.txt
```

#### Ensuring packages are not too new (10-day rule)

Fresh PyPI releases occasionally have regressions. To avoid installing a package
that was published less than 10 days ago, use pip's `--exclude-newer` option
(pip 23.3+, released 2023-10-15):

```bash
# Calculate a date 10 days before today and pass it to pip
pip install -r scripts/requirements.txt \
  --exclude-newer "$(python -c "from datetime import date, timedelta; print(date.today() - timedelta(days=10))")"
```

On Windows (PowerShell):

```powershell
$cutoff = (Get-Date).AddDays(-10).ToString("yyyy-MM-dd")
pip install -r scripts/requirements.txt --exclude-newer $cutoff
```

This tells pip to ignore any package version whose upload date is newer than the
cutoff. If a package has no version older than 10 days, pip will error and tell
you — at which point you can choose to install it anyway by omitting the flag.

### Script reference

| Script | Purpose |
|--------|---------|
| `init_catalog.py` | Bootstrap `_folder.json` and item sidecar stubs for a new content folder |
| `preview_catalog.py` | Render SVG thumbnails to `src/assets/previews/` as WebP |
| `post_catalog.py` | Build `assets.json` and `scenes.json` from validated sidecars |
| `examine_catalog.py` | Auto-generate descriptions for items and folders using an LLM (Ollama or OpenAI) |

### Typical workflow

```bash
# 1. Init sidecars for new content
python scripts/init_catalog.py --root source --target source/objects

# 2. Render previews
python scripts/preview_catalog.py \
  --content source/objects \
  --previews src/assets/previews \
  --target content/objects/Bodys

# 3. Generate AI descriptions (requires Ollama running locally)
python scripts/examine_catalog.py --content content --dry-run
python scripts/examine_catalog.py --content content

# 4. Build catalogue JSON and copy assets
python scripts/post_catalog.py \
  --content source/objects \
  --library src/assets/library \
  --previews src/assets/previews \
  --output src/assets/assets.json \
  --scenes source/saves \
  --scenes-dist src/assets/scenes \
  --scenes-output src/assets/scenes.json
```

### `examine_catalog.py` options

```
--content PATH        Root content directory (contains objects/, parts/, multicolor/)
--ollama-url URL      API base URL (default: http://localhost:11434/v1)
--api-key KEY         API key — Ollama ignores this (default: ollama)
--model NAME          Model to use (default: llama3)
--force               Re-generate descriptions even if they already exist
--dry-run             Preview changes without writing any files
```

---

## Further help

For Angular CLI help run `ng help` or see the [Angular CLI docs](https://angular.io/cli).
