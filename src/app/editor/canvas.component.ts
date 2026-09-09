import { Component, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSelectModule } from '@angular/material/select';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TranslateModule } from '@ngx-translate/core';
import { SceneStoreService } from '../core/scene-store.service';
import {
  Color, SceneNode, PrimitiveNode, TextNode,
  SvgObjectNode, MultiColorObjectNode, GroupNode,
  Transform, toSvgTransform,
} from '../core/models';
import { ToolStateService } from '../tools/tool-state.service';

@Component({
  selector: 'app-canvas',
  standalone: true,
  imports: [
    MatButtonModule,
    MatIconModule,
    MatSelectModule,
    MatTooltipModule,
    FormsModule,
    TranslateModule,
    CommonModule,
  ],
  templateUrl: './canvas.component.html',
  styleUrl: './canvas.component.scss',
})
export class CanvasComponent {
  zoomLevel = 100;
  zoomPresets = [10, 25, 50, 75, 100, 150, 200, 300, 400, 600, 800];

  canvasWidth  = computed(() => this.store.canvas().width);
  canvasHeight = computed(() => this.store.canvas().height);

  private dragging       = false;
  private dragStartX     = 0;
  private dragStartY     = 0;
  private dragNodeId     = '';
  private startTransform: Transform | null = null;

  viewportScale = 1;

  constructor(
    readonly store: SceneStoreService,
    readonly toolState: ToolStateService,
  ) {
    this.addTestNodes();
  }

  // ── helpers ──────────────────────────────────────────────────────────────

  cssColor(c: Color | null | undefined): string {
    if (!c) return 'none';
    return `rgb(${c[0]},${c[1]},${c[2]})`;
  }

  nodeTransform(node: SceneNode): string {
    return toSvgTransform(node.transform);
  }

  asPrimitive(n: SceneNode)     { return n as PrimitiveNode; }
  asText(n: SceneNode)          { return n as TextNode; }
  asSvgObject(n: SceneNode)     { return n as SvgObjectNode; }
  asMulticolor(n: SceneNode)    { return n as MultiColorObjectNode; }
  asGroup(n: SceneNode)         { return n as GroupNode; }

  // ── selection (MVP-14) ───────────────────────────────────────────────────

  onCanvasPointerDown(e: PointerEvent): void {
    const el = e.target as Element;
    if (el.classList.contains('scene-svg') || el.classList.contains('background')) {
      this.store.clearSelection();
    }
  }

  onNodePointerDown(e: PointerEvent, node: SceneNode): void {
    e.stopPropagation();
    if (node.locked) return;
    if (e.shiftKey) {
      this.store.toggleSelection(node.id);
    } else {
      this.store.setSelection([node.id]);
    }

    if (this.toolState.activeTool() === 'move') {
      this.dragging       = true;
      this.dragStartX     = e.clientX;
      this.dragStartY     = e.clientY;
      this.dragNodeId     = node.id;
      this.startTransform = { ...node.transform };
      (e.target as Element).setPointerCapture(e.pointerId);
    }
  }

  onPointerMove(e: PointerEvent): void {
    if (!this.dragging || !this.startTransform) return;

    const dx = (e.clientX - this.dragStartX) / this.viewportScale;
    const dy = (e.clientY - this.dragStartY) / this.viewportScale;

    this.store.updateTransform(this.dragNodeId, {
      ...this.startTransform,
      x: this.startTransform.x + dx,
      y: this.startTransform.y + dy,
    });
  }

  onPointerUp(e: PointerEvent): void {
    if (!this.dragging) return;
    this.dragging       = false;
    this.startTransform = null;
  }

  nodeBoundsW(node: SceneNode): number {
    if (node.type === 'primitive') return (node as PrimitiveNode).w;
    if (node.type === 'text')      return 200;
    if (node.type === 'group')     return 80;
    return 64;
  }

  nodeBoundsH(node: SceneNode): number {
    if (node.type === 'primitive') return (node as PrimitiveNode).h;
    if (node.type === 'text')      return (node as TextNode).size * 1.5;
    if (node.type === 'group')     return 80;
    return 64;
  }

  // ── temporary test nodes (remove in MVP-14) ─────────────────────────────

  private addTestNodes(): void {
    this.store.addNode({
      id: crypto.randomUUID(), type: 'primitive', label: 'Test Rect',
      shape: 'rect', w: 200, h: 120,
      fill: [100, 160, 240], stroke: [40, 80, 160], strokeWidth: 2,
      transform: { x: 100, y: 80, sx: 1, sy: 1, r: 0, px: 0, py: 0 },
      visible: true, locked: false,
    });

    this.store.addNode({
      id: crypto.randomUUID(), type: 'primitive', label: 'Test Ellipse',
      shape: 'ellipse', w: 160, h: 100,
      fill: [240, 200, 100], stroke: [160, 120, 40], strokeWidth: 2,
      transform: { x: 400, y: 120, sx: 1, sy: 1, r: 0.4, px: 0, py: 0 },
      visible: true, locked: false,
    });

    this.store.addNode({
      id: crypto.randomUUID(), type: 'text', label: 'Test Text',
      content: 'Hello LAOPS', font: 'Arial, sans-serif', size: 28,
      style: 'bold', color: [40, 40, 40],
      transform: { x: 120, y: 260, sx: 1, sy: 1, r: 0, px: 0, py: 0 },
      visible: true, locked: false,
    });

    this.store.addNode({
      id: crypto.randomUUID(), type: 'svg-object', label: 'Test Object',
      assetId: 'GO5',
      transform: { x: 600, y: 80, sx: 1, sy: 1, r: 0, px: 0, py: 0 },
      visible: true, locked: false,
    });

    this.store.addNode({
      id: crypto.randomUUID(), type: 'multicolor-object', label: 'Test Multi',
      assetId: 'MC1', parts: [],
      transform: { x: 320, y: 300, sx: 1, sy: 1, r: 0, px: 0, py: 0 },
      visible: true, locked: false,
    });

    this.store.addNode({
      id: crypto.randomUUID(), type: 'group', label: 'Test Group',
      sourceName: '', nodes: [],
      transform: { x: 700, y: 250, sx: 1, sy: 1, r: 0, px: 0, py: 0 },
      visible: true, locked: false,
    });
  }
}
