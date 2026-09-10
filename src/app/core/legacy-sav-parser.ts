import { SceneNode, Color, TextStyle } from './models';
import { newId } from './ids';
import { DEG2RAD } from './transform-math';
import { FONT_FAMILIES } from './font-list';

export interface ParseResult {
  nodes: SceneNode[];
  warnings: string[];
  header: {
    width: number;
    height: number;
    borderColor: Color;
    backgroundColor: Color;
  };
}

const RECORD_STARTS = new Set([
  'SCREEN_V2', 'OBJECT_V2', 'MULTICOLOR', 'RECTANGLE', 'ELLIPSE', 'TEXT_V1', 'GROUP_V2', 'PART'
]);

/**
 * Parses the legacy LAOPS `.sav` format (plain text, one `&`-delimited record
 * stream) into the new scene graph.
 *
 * Robust by design: unknown tokens, malformed numbers and unmatched asset
 * paths are skipped with a collected warning instead of aborting the import.
 */
export function parseLegacySav(text: string): ParseResult {
  const warnings: string[] = [];
  const nodes: SceneNode[] = [];

  const raw = text.replace(/\n/g, ' ').replace(/\r/g, '');
  const records = splitRecords(raw);
  const header: ParseResult['header'] = { width: 1024, height: 768, borderColor: [96, 125, 139], backgroundColor: [245, 245, 245] };

  let idx = 0;
  for (const f of records) {
    idx++;
    const token = f[0] ?? '';
    switch (token) {
      case 'SCREEN_V2':
        parseHeader(f, header);
        break;
      case 'OBJECT_V2':
        nodes.push(parseObject(f, warnings, idx));
        break;
      case 'MULTICOLOR':
        nodes.push(...parseMultiColor(f, warnings, idx));
        break;
      case 'RECTANGLE':
        nodes.push(parseShape(f, warnings, idx, 'rect'));
        break;
      case 'ELLIPSE':
        nodes.push(parseShape(f, warnings, idx, 'ellipse'));
        break;
      case 'TEXT_V1':
        nodes.push(parseText(f, warnings, idx));
        break;
      case 'GROUP_V2':
        warnings.push(`Record ${idx}: GROUP_V2 (embedded scene) skipped — not supported in browser import`);
        break;
      case 'PART':
        nodes.push(parsePart(f, warnings, idx));
        break;
      default:
        warnings.push(`Record ${idx}: unknown token "${token}" skipped`);
    }
  }

  return { nodes, warnings, header };
}

function splitRecords(raw: string): string[][] {
  const tokens = raw.split('&').map(decodeAnd);
  const out: string[][] = [];
  let cur: string[] | null = null;
  for (const t of tokens) {
    if (t === '') continue; // record-terminating '&'
    if (RECORD_STARTS.has(t)) {
      if (cur) out.push(cur);
      cur = [t];
    } else if (cur) {
      cur.push(t);
    }
    // tokens before the first known record start are ignored
  }
  if (cur) out.push(cur);
  return out;
}

function decodeAnd(p: string): string {
  return p.replace(/<-\|AND\|->/g, '&');
}

function parseHeader(f: string[], h: ParseResult['header']): void {
  h.width = Math.max(100, num(f[1], 1024));
  h.height = num(f[2], 768);
  const border = colorAt(f, 3);
  if (border) h.borderColor = border;
  const bg = colorAt(f, 6);
  if (bg) h.backgroundColor = bg;
}

function num(s: string | undefined, fallback = 0): number {
  if (s === undefined) return fallback;
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : fallback;
}

function colorAt(f: string[], i: number): Color | null {
  if (i + 2 >= f.length) return null;
  return [clamp255(f[i]), clamp255(f[i + 1]), clamp255(f[i + 2])];
}

function clamp255(s: string | undefined): number {
  const n = parseFloat(s ?? '');
  return Number.isFinite(n) ? Math.max(0, Math.min(255, Math.round(n))) : 0;
}

interface ShapeFields {
  x: number;
  y: number;
  sx: number;
  sy: number;
  px: number;
  py: number;
  r: number;
}

/**
 * Legacy transform field order: x, y, sX, sY, tX, tY, r(deg).
 * Maps to the new model with tX→px, tY→py and r converted to radians.
 */
function parseTransformAt(f: string[], i: number, warnings: string[], idx: number): ShapeFields {
  const take = (k: number, fallback = 0): number => {
    const v = f[k];
    if (v === undefined || v === '') return fallback;
    const n = parseFloat(v);
    if (!Number.isFinite(n)) {
      warnings.push(`Record ${idx}: bad transform field "${v}" → ${fallback}`);
      return fallback;
    }
    return n;
  };
  return {
    x: take(i),
    y: take(i + 1),
    sx: take(i + 2, 1),
    sy: take(i + 3, 1),
    px: take(i + 4),
    py: take(i + 5),
    r: take(i + 6) * DEG2RAD
  };
}

function transformOf(s: ShapeFields): SceneNode['transform'] {
  return { x: s.x, y: s.y, sx: s.sx, sy: s.sy, px: s.px, py: s.py, r: s.r };
}

function parseObject(f: string[], warnings: string[], idx: number): SceneNode {
  const rawPath = f[1] ?? '';
  const path = rawPath.replace(/\\/g, '/');
  const t = parseTransformAt(f, 2, warnings, idx);
  if (!path) {
    warnings.push(`Record ${idx}: OBJECT_V2 missing path — emitted grey placeholder rect`);
    return {
      id: newId(), type: 'primitive', shape: 'rect', label: 'Object',
      transform: transformOf(t), visible: true, locked: false,
      w: 64, h: 64, fill: [200, 200, 200], stroke: [0, 0, 0], strokeWidth: 1
    };
  }
  return {
    id: newId(),
    type: 'svg-object',
    assetId: path,
    label: baseName(path),
    transform: transformOf(t),
    visible: true,
    locked: false
  };
}

function parsePart(f: string[], warnings: string[], idx: number): SceneNode {
  // PART&{filePath}&{colorInfo}&{x}&{y}&{sX}&{sY}&{tX}&{tY}&{r}&
  const path = f[1] ?? '';
  const colorInfo = f[2] ?? '';
  const t = parseTransformAt(f, 3, warnings, idx);

  if (!path) {
    warnings.push(`Record ${idx}: PART missing path — emitted placeholder`);
    return {
      id: newId(), type: 'primitive', shape: 'rect', label: 'Part',
      transform: transformOf(t), visible: true, locked: false,
      w: 64, h: 64, fill: [200, 200, 200], stroke: null, strokeWidth: 0
    };
  }

  const normalizedPath = path.replace(/\\/g, '/');

  if (colorInfo && colorInfo !== '') {
    warnings.push(
      `Record ${idx}: PART "${normalizedPath}" color tint "${colorInfo}" not applied ` +
      `(svg-object tinting not supported)`
    );
  }

  return {
    id: newId(),
    type: 'svg-object',
    assetId: normalizedPath,
    label: baseName(normalizedPath),
    transform: transformOf(t),
    visible: true,
    locked: false
  };
}

function parseMultiColor(f: string[], warnings: string[], idx: number): SceneNode[] {
  const path = f[1] ?? '';
  const partCount = Math.max(0, Math.round(num(f[2])));
  if (!path) {
    warnings.push(`Record ${idx}: MULTICOLOR missing path — skipped`);
    return [];
  }
  const parts: { id: string; fill: Color; stroke: Color; strokeWidth: number }[] = [];
  let k = 3;
  for (let i = 0; i < partCount; i++) {
    const info = f[k];
    if (info === undefined) break;
    const c = parseColorInfo(info, warnings, idx);
    parts.push({ id: `part-${i + 1}`, fill: c.fill, stroke: c.stroke, strokeWidth: c.strokeWidth });
    k++;
  }
  const t = parseTransformAt(f, k, warnings, idx);
  if (!parts.length) {
    // no parsable color blocks — emit a plain svg-object instead
    return [{
      id: newId(), type: 'svg-object', assetId: path, label: baseName(path),
      transform: transformOf(t), visible: true, locked: false
    }];
  }
  return [{
    id: newId(),
    type: 'multicolor-object',
    assetId: path,
    label: baseName(path),
    transform: transformOf(t),
    visible: true,
    locked: false,
    parts
  }];
}

function parseColorInfo(
  info: string,
  warnings: string[],
  idx: number
): { fill: Color; stroke: Color; strokeWidth: number } {
  let fill: Color | null = null;
  let stroke: Color | null = null;
  let strokeWidth = 2;
  const tokens = info.split(':').map(s => s.trim()).filter(s => s.length > 0);
  let i = 0;
  while (i < tokens.length - 3) {
    const k = tokens[i];
    if (k === 'S') {
      stroke = [clamp255(tokens[i + 1]), clamp255(tokens[i + 2]), clamp255(tokens[i + 3])];
      i += 4;
    } else if (k === 'W') {
      strokeWidth = parseFloat(tokens[i + 1]) || 2;
      i += 2;
    } else if (k === 'F') {
      fill = [clamp255(tokens[i + 1]), clamp255(tokens[i + 2]), clamp255(tokens[i + 3])];
      i += 4;
    } else {
      i++;
    }
  }
  if (fill === null) {
    warnings.push(`Record ${idx}: color block without :F:`);
    fill = [200, 200, 200];
  }
  if (stroke === null) stroke = [0, 0, 0];
  return { fill, stroke, strokeWidth };
}

function parseShape(f: string[], warnings: string[], idx: number, shape: 'rect' | 'ellipse'): SceneNode {
  const info = f[1] ?? '';
  const c = parseColorInfo(info, warnings, idx);
  const t = parseTransformAt(f, 2, warnings, idx);
  return {
    id: newId(),
    type: 'primitive',
    shape,
    label: shape === 'rect' ? 'Rectangle' : 'Ellipse',
    transform: transformOf(t),
    visible: true,
    locked: false,
    w: 128,
    h: 80,
    fill: c.fill,
    stroke: c.stroke,
    strokeWidth: c.strokeWidth
  };
}

function parseText(f: string[], warnings: string[], idx: number): SceneNode {
  const content = f[1] ?? '';
  const fill: Color = [clamp255(f[2]), clamp255(f[3]), clamp255(f[4])];
  const fontName = f[5] ?? 'Arial';
  const fontStyle = (f[6] ?? '').toLowerCase();
  const fontSize = num(f[7], 24);
  const t = parseTransformAt(f, 8, warnings, idx);
  const safe = safeFont(fontName);
  if (safe !== fontName) {
    warnings.push(`Record ${idx}: unknown font "${fontName}" → ${safe}`);
  }
  const style = textStyleOf(fontStyle);
  const label = style ? `(${style}) Text` : 'Text';
  return {
    id: newId(),
    type: 'text',
    label,
    content,
    font: safe,
    size: fontSize,
    style: style ?? 'normal',
    color: fill,
    transform: transformOf(t),
    visible: true,
    locked: false
  };
}

function textStyleOf(raw: string): TextStyle | undefined {
  const v = raw.toLowerCase().replace(/[^a-z]/g, '');
  if (v.includes('bold') && v.includes('italic')) return 'bold italic';
  if (v.includes('italic')) return 'italic';
  if (v.includes('bold')) return 'bold';
  return undefined;
}

function safeFont(name: string): string {
  const lower = name.toLowerCase();
  const found = FONT_FAMILIES.find(f => f.toLowerCase().includes(lower));
  return found ?? 'Arial, sans-serif';
}

function baseName(path: string): string {
  const clean = path.split(/[\\/]/).pop() ?? path;
  return clean.replace(/\.svg$/i, '');
}
