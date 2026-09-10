import { Color, MultiColorPart } from './models';

export function colorToCss(c: Color, alpha = 1): string {
  return `rgba(${c[0]},${c[1]},${c[2]},${alpha})`;
}

const SHAPE_SELECTOR = 'path,rect,circle,ellipse,polygon,polyline,line';

function isShape(el: Element): boolean {
  return SHAPE_SELECTOR.split(',').includes(el.nodeName.toLowerCase());
}

/**
 * Apply part color overrides to a host element holding the flattened SVG root
 * content (the canvas asset host <g> or the SVG-export wrapper <g>).
 *
 * Mirrors extractSvgPartIds / detect_multicolor: when the SVG root had a
 * single top-level <g> wrapper, the part groups live inside it.
 *
 * A shape's own fill/stroke presentation attribute always wins over a value
 * inherited from its parent <g>, so overrides are applied as inline styles on
 * every shape descendant — inline style beats presentation attributes. The
 * part <g> itself also gets the fill/stroke attribute for shapes that do not
 * carry their own value. Removing an override (fill/stroke === undefined)
 * removes the inline style and the group attribute, restoring the original
 * SVG default.
 */
export function applyMultiColorPartOverrides(host: Element, parts: readonly MultiColorPart[]): void {
  const overrides = new Map<string, MultiColorPart>(parts.map(p => [p.id, p]));
  const hostChildren = Array.from(host.children);
  const partParent = hostChildren.length === 1 && hostChildren[0].nodeName.toLowerCase() === 'g'
    ? hostChildren[0]
    : host;
  for (const child of Array.from(partParent.children)) {
    const partId = child.getAttribute('id');
    if (!partId) continue;
    applyPartOverride(child, overrides.get(partId));
  }
}

function applyPartOverride(el: Element, ov: MultiColorPart | undefined): void {
  if (isShape(el)) {
    paintPartShape(el, ov);
    return;
  }
  if (ov?.fill !== undefined) {
    el.setAttribute('fill', ov.fill ? colorToCss(ov.fill) : 'none');
  } else {
    el.removeAttribute('fill');
  }
  if (ov?.stroke !== undefined) {
    el.setAttribute('stroke', ov.stroke ? colorToCss(ov.stroke) : 'none');
  } else {
    el.removeAttribute('stroke');
  }
  for (const s of Array.from(el.querySelectorAll(SHAPE_SELECTOR))) paintPartShape(s, ov);
}

function paintPartShape(el: Element, ov: MultiColorPart | undefined): void {
  // Inline style only: it beats a shape's own fill/stroke presentation
  // attributes, and removing it restores the original SVG default — no
  // attribute destruction, fully reversible.
  const st = (el as SVGElement).style;
  if (ov?.fill !== undefined) st.setProperty('fill', ov.fill ? colorToCss(ov.fill) : 'none');
  else st.removeProperty('fill');
  if (ov?.stroke !== undefined) st.setProperty('stroke', ov.stroke ? colorToCss(ov.stroke) : 'none');
  else st.removeProperty('stroke');
  if (ov?.strokeWidth !== undefined) st.setProperty('stroke-width', String(ov.strokeWidth));
  else st.removeProperty('stroke-width');
}
