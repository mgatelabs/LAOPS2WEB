import { Injectable, inject } from '@angular/core';
import { Scene, SceneNode, CanvasSettings, Color } from './models';
import { ToastService } from './toast.service';

export interface PngExportOptions {
  scale: number;
  transparent: boolean;
}

export function colorToCss(c: Color, alpha = 1): string {
  return `rgba(${c[0]},${c[1]},${c[2]},${alpha})`;
}

@Injectable({ providedIn: 'root' })
export class ExportService {
  private readonly toast = inject(ToastService);

  readonly exporting = new Set<string>();

  async exportPng(svgEl: SVGSVGElement, canvas: CanvasSettings, options: PngExportOptions, filename: string): Promise<void> {
    const id = 'export-png';
    this.exporting.add(id);
    try {
      const blob = await this.renderPng(svgEl, canvas, options);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    } finally {
      this.exporting.delete(id);
    }
  }

  async copyPngToClipboard(svgEl: SVGSVGElement, canvas: CanvasSettings, options: PngExportOptions): Promise<boolean> {
    try {
      const blob = await this.renderPng(svgEl, canvas, options);
      if (typeof ClipboardItem === 'undefined') {
        this.toast.error('ERROR.CLIPBOARD_UNSUPPORTED');
        return false;
      }
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      this.toast.success('TOAST.PNG_COPIED');
      return true;
    } catch {
      this.toast.error('ERROR.CLIPBOARD_FAILED');
      return false;
    }
  }

  exportSvg(scene: Scene, filename: string, withSelection = false): void {
    const svg = this.serializeSceneSvg(scene, withSelection);
    this.downloadBlob(svg, filename, 'image/svg+xml');
  }

  async copySvgToClipboard(scene: Scene): Promise<boolean> {
    const svg = this.serializeSceneSvg(scene, false);
    const ok = await this.writeText(svg);
    this.toast[ok ? 'success' : 'error']('TOAST.SVG_COPIED');
    return ok;
  }

  async copyJsonToClipboard(scene: Scene): Promise<boolean> {
    const ok = await this.writeText(JSON.stringify(scene, null, 2));
    this.toast[ok ? 'success' : 'error']('TOAST.JSON_COPIED');
    return ok;
  }

  private async writeText(text: string): Promise<boolean> {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      return false;
    }
  }

  private downloadBlob(content: string, name: string, type: string): void {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  async renderPng(svgEl: SVGSVGElement, canvas: CanvasSettings, options: PngExportOptions): Promise<Blob> {
    const clone = await this.prepareSvg(svgEl, canvas, options);
    const dataUrl = this.svgToDataUrl(clone);
    const img = await this.loadImage(dataUrl);
    const w = Math.round(canvas.width * options.scale);
    const h = Math.round(canvas.height * options.scale);
    const canvasEl = document.createElement('canvas');
    canvasEl.width = w;
    canvasEl.height = h;
    const ctx = canvasEl.getContext('2d');
    if (!ctx) throw new Error('no 2d context');
    if (!options.transparent) {
      ctx.fillStyle = colorToCss(canvas.backgroundColor);
      ctx.fillRect(0, 0, w, h);
    }
    ctx.drawImage(img, 0, 0, w, h);
    return await new Promise<Blob>((resolve, reject) => {
      canvasEl.toBlob(b => {
        if (b) resolve(b);
        else reject(new Error('toBlob failed'));
      }, 'image/png');
    });
  }

  private async prepareSvg(svgEl: SVGSVGElement, canvas: CanvasSettings, options: PngExportOptions): Promise<SVGSVGElement> {
    const clone = svgEl.cloneNode(true) as SVGSVGElement;
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    clone.setAttribute('width', String(canvas.width));
    clone.setAttribute('height', String(canvas.height));
    clone.setAttribute('viewBox', `0 0 ${canvas.width} ${canvas.height}`);
    clone.querySelectorAll('[data-laops-ui]').forEach(el => el.remove());
    const bg = clone.querySelector('[data-laops-bg]');
    if (bg) {
      (bg as SVGRectElement).style.fill = options.transparent ? 'transparent' : colorToCss(canvas.backgroundColor);
    }
    // inline critical styles so a standalone render looks right
    const style = document.createElementNS('http://www.w3.org/2000/svg', 'style');
    style.textContent = `.laops-node rect,.laops-node ellipse{vector-effect:none}`;
    clone.insertBefore(style, clone.firstChild);
    return clone;
  }

  private serializeSceneSvg(scene: Scene, withSelection: boolean): string {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    svg.setAttribute('width', String(scene.canvas.width));
    svg.setAttribute('height', String(scene.canvas.height));
    svg.setAttribute('viewBox', `0 0 ${scene.canvas.width} ${scene.canvas.height}`);
    const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    bg.setAttribute('width', String(scene.canvas.width));
    bg.setAttribute('height', String(scene.canvas.height));
    bg.setAttribute('fill', colorToCss(scene.canvas.backgroundColor));
    svg.appendChild(bg);
    this.appendNodes(svg, scene.nodes, new Set(), withSelection);
    const xml = new XMLSerializer().serializeToString(svg);
    return '<?xml version="1.0" encoding="UTF-8"?>\n' + xml;
  }

  private appendNodes(parent: Element | DocumentFragment, nodes: SceneNode[], visited: Set<string>, withSelection: boolean): void {
    for (const node of nodes) {
      if (visited.has(node.id)) continue;
      visited.add(node.id);
      if (!node.visible) continue;
      if (node.type === 'group') {
        const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        g.setAttribute('transform', this.transformAttr(node));
        parent.appendChild(g);
        this.appendNodes(g, node.nodes, visited, withSelection);
      } else if (node.type === 'primitive') {
        const shape = document.createElementNS('http://www.w3.org/2000/svg', node.shape === 'rect' ? 'rect' : 'ellipse');
        this.applyPrimitiveGeometry(shape, node);
        this.applyTransform(shape, node);
        this.applyFillStroke(shape, node.fill, node.stroke, node.strokeWidth);
        parent.appendChild(shape);
      } else if (node.type === 'text') {
        const t = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        t.setAttribute('font-family', node.font);
        t.setAttribute('font-size', String(node.size));
        if (node.style) {
          if (node.style.includes('bold')) t.setAttribute('font-weight', 'bold');
          if (node.style.includes('italic')) t.setAttribute('font-style', 'italic');
        }
        t.setAttribute('fill', colorToCss(node.color));
        this.applyTransform(t, node);
        const lines = node.content.split('\n');
        if (lines.length <= 1) {
          t.textContent = lines[0] ?? '';
        } else {
          for (let i = 0; i < lines.length; i++) {
            const ts = document.createElementNS('http://www.w3.org/2000/svg', 'tspan');
            ts.setAttribute('x', '0');
            if (i > 0) ts.setAttribute('dy', '1.2em');
            ts.textContent = lines[i];
            t.appendChild(ts);
          }
        }
        parent.appendChild(t);
      }
      // svg-object / multicolor-object: their shapes are cloned at render time;
      // for pure-SVG export the caller should use the live DOM node instead.
    }
  }

  private transformAttr(node: SceneNode): string {
    const t = node.transform;
    const deg = (t.r * 180) / Math.PI;
    return `translate(${t.x} ${t.y}) rotate(${deg}) scale(${t.sx} ${t.sy}) translate(${t.px} ${t.py})`;
  }

  private applyTransform(el: Element, node: SceneNode): void {
    el.setAttribute('transform', this.transformAttr(node));
  }

  private applyPrimitiveGeometry(el: SVGElement, node: SceneNode): void {
    if (node.type !== 'primitive') return;
    if (node.shape === 'rect') {
      el.setAttribute('x', String(-node.w / 2));
      el.setAttribute('y', String(-node.h / 2));
      el.setAttribute('width', String(node.w));
      el.setAttribute('height', String(node.h));
    } else {
      el.setAttribute('rx', String(node.w / 2));
      el.setAttribute('ry', String(node.h / 2));
      el.setAttribute('cx', '0');
      el.setAttribute('cy', '0');
    }
  }

  private applyFillStroke(el: SVGElement, fill?: Color | null, stroke?: Color | null, strokeWidth?: number): void {
    el.setAttribute('fill', fill != null ? colorToCss(fill) : 'none');
    if (stroke != null) {
      el.setAttribute('stroke', colorToCss(stroke));
      el.setAttribute('stroke-width', String(strokeWidth ?? 0));
    } else {
      el.setAttribute('stroke', 'none');
    }
  }

  private svgToDataUrl(svg: SVGSVGElement): string {
    const xml = new XMLSerializer().serializeToString(svg);
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(xml);
  }

  private loadImage(src: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('failed to load svg image'));
      img.src = src;
    });
  }
}
