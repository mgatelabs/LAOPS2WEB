// Canvas settings

export type Color = [number, number, number]; // [r, g, b], each 0–255

export interface CanvasSettings {
  width: number;            // minimum 100, default 640
  height: number;           // default 480
  backgroundColor: Color;
  borderColor: Color;
  transparentBackground?: boolean;  // default false
}

// Transform

export interface Transform {
  x: number;   // world position — the pivot dot; rotation/scale origin
  y: number;
  sx: number;  // scaleX — default 1.0, negative = mirrored
  sy: number;  // scaleY
  r: number;   // rotation in radians, around (x, y)
  px: number;  // content offset X from pivot, in rotated local space
  py: number;  // content offset Y from pivot, in rotated local space
}

export const IDENTITY_TRANSFORM: Transform = {
  x: 0, y: 0, sx: 1, sy: 1, r: 0, px: 0, py: 0,
};

export function toSvgTransform(t: Transform): string {
  const deg = t.r * 180 / Math.PI;
  // (x,y) is the pivot/rotation origin. Content is offset by (px,py) in local space.
  return `translate(${t.x} ${t.y}) rotate(${deg}) scale(${t.sx} ${t.sy}) translate(${t.px} ${t.py})`;
}

export function isIdentity(t: Transform): boolean {
  return t.x === 0 && t.y === 0 && t.sx === 1 && t.sy === 1
      && t.r === 0 && t.px === 0 && t.py === 0;
}

// Node types

export type NodeType =
  | 'svg-object'
  | 'multicolor-object'
  | 'primitive'
  | 'text'
  | 'group';

export interface BaseNode {
  id: string;           // UUID v4, assigned at creation, never changes
  type: NodeType;
  label: string;        // user-editable display name
  transform: Transform; // always present (identity when default)
  visible: boolean;     // default true
  locked: boolean;      // default false
}

export interface SvgObjectNode extends BaseNode {
  type: 'svg-object';
  assetId: string;      // opaque ID from assets.json, e.g. "GO5"
}

export interface MultiColorPart {
  id: string;            // matches <g id="..."> in the SVG
  fill?: Color | null;   // undefined = SVG default; null = explicit none
  stroke?: Color | null;
  strokeWidth?: number;
}

export interface MultiColorObjectNode extends BaseNode {
  type: 'multicolor-object';
  assetId: string;
  parts: MultiColorPart[];  // only overridden parts; empty = all SVG defaults
}

export interface PrimitiveNode extends BaseNode {
  type: 'primitive';
  shape: 'rect' | 'ellipse' | 'polygon';
  w: number;
  h: number;
  fill?: Color | null;
  stroke?: Color | null;
  strokeWidth?: number;
  // polygon-only fields (ignored for rect/ellipse):
  sides?: number;      // 3–32, default 3
  variation?: number;  // 0.0–1.0, default 0 (flat polygon)
}

export type FontStyle = 'normal' | 'bold' | 'italic' | 'bold italic';

/** Alias retained for legacy-sav-parser compatibility. */
export type TextStyle = FontStyle;

export interface TextNode extends BaseNode {
  type: 'text';
  content: string;
  font: string;       // full CSS font-family stack, e.g. "Arial, sans-serif"
  size: number;       // font-size in points
  style: FontStyle;
  color: Color | null;         // null = transparent fill (no fill paint)
  stroke?: Color | null;       // undefined = none; null = explicit none; Color = colour
  strokeWidth?: number;        // default 0
}

export interface GroupNode extends BaseNode {
  type: 'group';
  sourceName: string; // original filename, display only; empty = created in-editor
  nodes: SceneNode[];
}

export type SceneNode =
  | SvgObjectNode
  | MultiColorObjectNode
  | PrimitiveNode
  | TextNode
  | GroupNode;

// Scene

export interface Scene {
  version: 2;
  savedAt: string;       // ISO 8601 timestamp
  canvas: CanvasSettings;
  nodes: SceneNode[];
}

export function defaultScene(): Scene {
  return {
    version: 2,
    savedAt: new Date().toISOString(),
    canvas: {
      width: 800,
      height: 600,
      backgroundColor: [255, 255, 255],
      borderColor: [180, 180, 180],
    },
    nodes: [],
  };
}

// Asset catalogue types

export interface AssetPart {
  id: string;     // matches <g id="..."> in the SVG
  label: string;
}

export interface AssetItem {
  id: string;               // opaque, e.g. "GO5"
  label: string;
  description: string;
  author: string;
  tags: string[];
  path: string;             // relative to src/assets/, e.g. "objects/Bodys/GORDON.svg"
  preview: string;          // relative to src/assets/, e.g. "objects/Bodys/GORDON.webp"
  multiColor: boolean;
  parts: AssetPart[];
}

export interface AssetFolder {
  id: string;
  label: string;
  description: string;
  author: string;
  folders: AssetFolder[];   // recursive
  items: AssetItem[];
}

export interface AssetSection {
  id: string;       // "objects" | "parts" | "multicolor"
  label: string;
  folders: AssetFolder[];
}

export interface AssetCatalogue {
  version: number;
  generated: string;
  sections: AssetSection[];
}

// Asset resolution helper

export function resolveAsset(assetId: string, catalogue: AssetCatalogue): AssetItem | null {
  function searchFolders(folders: AssetFolder[]): AssetItem | null {
    for (const folder of folders) {
      for (const item of folder.items) {
        if (item.id === assetId) return item;
      }
      const found = searchFolders(folder.folders);
      if (found) return found;
    }
    return null;
  }
  for (const section of catalogue.sections) {
    const found = searchFolders(section.folders);
    if (found) return found;
  }
  return null;
}

// Scene library types

export interface SceneItem {
  id: string;
  label: string;
  description: string;
  author: string;
  tags: string[];
  path: string;     // relative to src/assets/
  preview: string;  // relative to src/assets/
}

export interface SceneFolder {
  id: string;
  label: string;
  description: string;
  author: string;
  folders: SceneFolder[];
  items: SceneItem[];
}

export interface SceneCatalogue {
  version: number;
  generated: string;
  folders: SceneFolder[];
}

// Default node factories

export function defaultTextNode(x: number, y: number): TextNode {
  return {
    id: crypto.randomUUID(),
    type: 'text',
    label: 'Text',
    transform: { ...IDENTITY_TRANSFORM, x, y },
    visible: true,
    locked: false,
    content: 'Text',
    font: 'Roboto, sans-serif',
    size: 24,
    style: 'normal',
    color: [33, 33, 33],
  };
}
