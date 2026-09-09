# L.A.O.P.S — Feature & Format Reference

> Written for the purpose of planning a potential Angular web port. Covers every feature of the original Java application, the save file format, and export capabilities.

---

## What is LAOPS?

A scene composition tool. You build a picture by placing modular SVG objects (characters, weapons, props, backgrounds) on a canvas, transforming them individually, and saving the result. The asset library is Half-Life 2 themed but the engine is generic — any SVG works.

The core loop: **pick an object from the library → place it → transform it → layer it → save.**

---

## Object Types

The scene graph holds six distinct node types. Every node shares a common transform set (see below).

### 1. SVG Object
The primary building block. Loads an SVG file from the `objects/` library and renders it as a vector shape. The parsed geometry is stored internally — once loaded, the original file path is only needed for re-saving.

### 2. Part (Internal SVG)
Like an SVG Object but loaded from the `parts/` folder. The distinction is UI-only — parts are smaller body-component SVGs intended for fine-grained character customization (individual shirts, pants, eyes, hair, etc.).

### 3. Primitive Shape
A programmatically created rectangle or ellipse — no external file needed. Has independently editable fill color, stroke color, and stroke width.

### 4. Multi-Color Object
An SVG whose named `<g id="...">` groups are exposed as individually colorable parts. For example a body SVG might have separate groups for skin, shirt, and pants — each gets its own fill/stroke color in the editor. This is how character color customization works.

### 5. Text Node
A string rendered with a chosen font, size, style (plain/bold/italic), and color. Stored as text in the save file so it remains editable after reload.

### 6. Group (Embedded Scene)
References another `.sav` file and embeds its entire scene as a single transformable unit. Supports up to 8 levels of nesting. Used to compose complex pre-built characters and then place them into a larger scene.

---

## Transforms — What You Can Do to Any Object

Every object type supports the full same set of transforms:

| Property | Description |
|----------|-------------|
| **Position** `x, y` | Absolute canvas coordinates (float precision) |
| **Scale** `sX, sY` | Independent horizontal and vertical scale. Can be negative to mirror. |
| **Rotation** `r` | Angle in radians, free rotation |
| **Control point offset** `tX, tY` | Shifts the local origin — moves the pivot point without moving the object's world position. Affects where rotation and scale are anchored. |

**Flip** is implemented by negating `sX` (horizontal) or `sY` (vertical) — not a separate flag.

**Precision modes** exist for scale and rotate: normal mode moves at 0.005× mouse delta, precision mode at 0.0001×.

**Move All** moves every object in the scene simultaneously by the same delta — useful for recentering a composition.

**Fix Scale** equalizes `sX` and `sY` to the larger of the two, snapping back to uniform scale after asymmetric edits.

**Reset** returns all transform properties to identity: position (0,0), scale (1,1), rotation 0, offset (0,0).

**Clone** duplicates the selected object including all its geometry and current transform state.

**Z-order** is controlled by position in the render list. Up/Down buttons swap the node with its neighbor. First in list = rendered first = furthest back.

---

## Canvas

- Configurable width and height (minimum 100×100, default 800×600)
- Separate colors for the canvas background and the surrounding window area
- Zoom levels: 25%, 50%, 100%, 200%
- Objects can be positioned outside canvas bounds — there is no clamping

---

## Multi-Color Editing

When a Multi-Color Object is selected and the edit button is pressed, each named SVG group is listed as a separate row. Per part you can set:

- Fill color (or none)
- Stroke color (or none)
- Stroke width

This is the mechanism that lets the same body SVG appear in any color combination without duplicating the SVG file.

---

## Primitive Shape Editing

Rectangles and ellipses expose:

- Width and height (independent of the scale transform)
- Fill color (or none)
- Stroke color (or none)
- Stroke width

---

## Text Editing

Text nodes expose:

- The text string itself
- Font name (any system font)
- Font style: plain, bold, italic
- Font size (points)
- Text color

---

## Save File Format (`.sav`)

Plain text, single line, `&`-delimited. Human-readable. Every scene is one long string.

### Header

```
SCREEN_V2&{width}&{height}&{windowR}&{windowG}&{windowB}&{bgR}&{bgG}&{bgB}&
```

Two colors: the outer window border color and the canvas background color, each as R G B integers 0–255.

### Object Records (one per object, appended in render order)

**SVG Object:**
```
OBJECT_V2&{filePath}&{x}&{y}&{sX}&{sY}&{tX}&{tY}&{r}&
```

**Group (embedded scene):**
```
GROUP_V2&{filePath}&{x}&{y}&{sX}&{sY}&{tX}&{tY}&{r}&
```

**Text:**
```
TEXT_V1&{text}&{r}&{g}&{b}&{fontName}&{fontStyle}&{fontSize}&{x}&{y}&{sX}&{sY}&{tX}&{tY}&{r}&
```
Literal `&` characters in the text string are encoded as `<-|AND|->`.

**Rectangle / Ellipse:**
```
RECTANGLE&{colorInfo}&{x}&{y}&{sX}&{sY}&{tX}&{tY}&{r}&
ELLIPSE&{colorInfo}&{x}&{y}&{sX}&{sY}&{tX}&{tY}&{r}&
```

**Part (internal SVG):**
```
PART&{filePath}&{colorInfo}&{x}&{y}&{sX}&{sY}&{tX}&{tY}&{r}&
```

**Multi-Color Object:**
```
MULTICOLOR&{filePath}&{partCount}&{colorInfo1}&{colorInfo2}&...&{x}&{y}&{sX}&{sY}&{tX}&{tY}&{r}&
```

### Color Info Block

Used by Rectangle, Ellipse, Part, and each part of a Multi-Color object:

```
:S:{r}:{g}:{b}:W:{strokeWidth}:F:{r}:{g}:{b}
```

- `:S:` — stroke color (RGB 0–255), omitted if no stroke
- `:W:` — stroke width (float), omitted if no stroke
- `:F:` — fill color (RGB 0–255), omitted if no fill

Example: `:S:0:0:0:W:1.0:F:207:180:123` = black 1px stroke, tan fill.

### Thumbnails

On every save, two PNG files are written alongside the `.sav`:

- `{name}.sav.png` — 128×128 preview
- `{name}.sav.mini.png` — 32×32 thumbnail (used in the file chooser list)

Both are auto-generated by rendering the scene at a scaled-down size.

---

## SVG Parsing — What It Can Read

The custom SVG parser supports a useful subset of SVG 1.0:

**Elements:**
- `<path>` — full path with M/L/H/V/C/S/Q/Z commands (absolute and relative)
- `<rect>` — converted to a closed path
- `<circle>` — converted to an ellipse path
- `<line>` — converted to a two-point path
- `<g>` — groups, including nested groups, with transform attribute

**Attributes:**
- `fill` — hex color or `none`
- `stroke` — hex color or `none`
- `stroke-width` — integer
- `style` — inline CSS for fill/stroke/stroke-width
- `transform` — translate, scale, rotate (applied as AffineTransform)
- `display` — visibility
- `id` — used to identify parts in Multi-Color objects

**What it does not support:** gradients, patterns, text elements, clip paths, symbols, `use`, `defs`, or any SVG 1.1+ features.

---

## Export

Three formats, all produced from the live scene:

### PNG / JPEG
Renders the canvas `BufferedImage` and writes it via Java ImageIO. Pixel-exact match of what you see on screen at 100% zoom.

### SVG
Generates a new SVG XML file from the scene's current geometry. The export process:

1. Walks the scene graph node by node
2. Applies the full cumulative `AffineTransform` (position → rotation → scale → offset) to each path
3. Writes each resulting `GeneralPath` as a `<path>` element with `d`, `fill`, `stroke`, and `stroke-width` attributes

Path commands written: `M` (moveto), `L` (lineto), `C` (cubic bezier), `S` (quadratic/smooth), `Z` (close).

**Important:** the exported SVG contains only flattened geometry — no groups, no references back to source SVG files, no text elements. It is a single merged snapshot of the scene.

---

## What an Angular Port Could Do Natively

Angular + browser SVG is a strong match for this because:

- The `.sav` format is plain text and trivially parseable — no binary decoder needed
- All transforms map directly to SVG `transform` attributes (`translate`, `rotate`, `scale`) — no matrix math required beyond what the browser already does
- Multi-Color editing maps cleanly to CSS fill/stroke overrides on `<g>` elements
- The export to SVG would be as simple as serializing the live DOM
- PNG/JPEG export is available via `<canvas>` and the Canvas 2D API
- The asset library (800+ SVG files) loads directly in a browser without any parsing layer
- Thumbnail generation can be done with off-screen `<canvas>` or `createObjectURL`

The trickiest parts to port:

- **Group/embedded scene loading** — recursive `.sav` file loading would need async resolution
- **Precision mouse dragging** — needs careful pointer event handling to match the feel of the original
- **`tX`/`tY` control point offset** — slightly non-obvious in SVG transform terms; needs a composed transform of `translate(tX,tY) rotate(r) scale(sX,sY) translate(x,y)` in the right order
