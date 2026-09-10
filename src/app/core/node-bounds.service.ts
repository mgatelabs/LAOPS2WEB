import { Injectable, inject } from '@angular/core';
import { SceneNode, PrimitiveNode, TextNode, SvgObjectNode, GroupNode } from './models';
import { SvgCacheService } from './svg-cache.service';

@Injectable({ providedIn: 'root' })
export class NodeBoundsService {
  private readonly svgCache = inject(SvgCacheService);

  w(node: SceneNode): number {
    if (node.type === 'primitive') return (node as PrimitiveNode).w;
    if (node.type === 'text')      return this.textW(node as TextNode);
    if (node.type === 'group')     return this.groupAABB(node as GroupNode).w;
    if (node.type === 'svg-object' || node.type === 'multicolor-object') {
      const sz = this.svgCache.getSvgSize((node as SvgObjectNode).assetId);
      return sz ? sz.w : 64;
    }
    return 64;
  }

  h(node: SceneNode): number {
    if (node.type === 'primitive') return (node as PrimitiveNode).h;
    if (node.type === 'text')      return this.textH(node as TextNode);
    if (node.type === 'group')     return this.groupAABB(node as GroupNode).h;
    if (node.type === 'svg-object' || node.type === 'multicolor-object') {
      const sz = this.svgCache.getSvgSize((node as SvgObjectNode).assetId);
      return sz ? sz.h : 64;
    }
    return 64;
  }

  x(node: SceneNode): number {
    if (node.type === 'group') return this.groupAABB(node as GroupNode).x;
    return 0;
  }

  y(node: SceneNode): number {
    if (node.type === 'group') return this.groupAABB(node as GroupNode).y;
    return 0;
  }

  centre(node: SceneNode): { x: number; y: number } {
    return {
      x: node.transform.x + this.w(node) / 2,
      y: node.transform.y + this.h(node) / 2,
    };
  }

  private textW(node: TextNode): number {
    return this.measureText(node).w;
  }

  private textH(node: TextNode): number {
    return this.measureText(node).h;
  }

  private measureText(node: TextNode): { w: number; h: number } {
    try {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (!ctx) return { w: 64, h: node.size * 1.2 };
      const style = node.style === 'normal' ? '' : node.style;
      ctx.font = `${style} ${node.size}px ${node.font}`.trim();
      const lines = node.content.split('\n');
      let maxW = 0;
      for (const line of lines) {
        maxW = Math.max(maxW, ctx.measureText(line || ' ').width);
      }
      const lineH = node.size * 1.2;
      return {
        w: Math.max(10, maxW),
        h: Math.max(10, lineH * lines.length),
      };
    } catch {
      return { w: 64, h: node.size * 1.2 };
    }
  }

  private groupAABB(g: GroupNode): { x: number; y: number; w: number; h: number } {
    if (!g.nodes.length) return { x: 0, y: 0, w: 80, h: 80 };
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const child of g.nodes) {
      if (child.visible === false) continue;
      const cw = this.w(child);
      const ch = this.h(child);
      const cx = this.x(child) + child.transform.x + child.transform.px;
      const cy = this.y(child) + child.transform.y + child.transform.py;
      minX = Math.min(minX, cx);
      minY = Math.min(minY, cy);
      maxX = Math.max(maxX, cx + cw * Math.abs(child.transform.sx));
      maxY = Math.max(maxY, cy + ch * Math.abs(child.transform.sy));
    }
    if (!isFinite(minX)) return { x: 0, y: 0, w: 80, h: 80 };
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  }
}
