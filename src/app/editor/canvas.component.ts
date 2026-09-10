import {
  Component, ViewChild, HostListener,
  OnInit, AfterViewInit, OnDestroy,
  computed, effect, inject, DestroyRef,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDividerModule } from '@angular/material/divider';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule, MatMenuTrigger } from '@angular/material/menu';
import { MatSelectModule } from '@angular/material/select';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { SceneStore } from '../core/scene-store';
import {
  Color, SceneNode, PrimitiveNode, TextNode,
  SvgObjectNode, MultiColorObjectNode, GroupNode,
  Transform, toSvgTransform, IDENTITY_TRANSFORM,
  defaultTextNode,
} from '../core/models';
import { ToolStateService, ToolId } from '../tools/tool-state.service';
import { SvgCacheService } from '../core/svg-cache.service';
import { NodeBoundsService } from '../core/node-bounds.service';
import { collectAssetIdsRec, FileIoService } from '../core/file-io.service';
import { ViewStateService } from '../core/view-state.service';
import { applyMultiColorPartOverrides } from '../core/multicolor-override';
import { DEG2RAD, Mat3, IDENTITY_MAT3, toMatrix, multiplyMat, applyMatrixPoint } from '../core/transform-math';

type HandlePos = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

function isEditableTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

@Component({
  selector: 'app-canvas',
  standalone: true,
  imports: [
    MatButtonModule,
    MatDividerModule,
    MatIconModule,
    MatMenuModule,
    MatSelectModule,
    MatTooltipModule,
    FormsModule,
    TranslateModule,
    CommonModule,
  ],
  templateUrl: './canvas.component.html',
  styleUrl: './canvas.component.scss',
})
export class CanvasComponent implements OnInit, AfterViewInit, OnDestroy {
  readonly MinZoom = 0.1;
  readonly MaxZoom = 8;

  @ViewChild('viewport') viewportEl!: { nativeElement: HTMLElement };

  zoomLevel = 100;
  zoomPresets = [10, 25, 50, 75, 100, 150, 200, 300, 400, 600, 800];

  // ── infinite pan/zoom (MVP-25) ────────────────────────────────────────────

  panX = 0;
  panY = 0;
  zoom = 1;

  private panning    = false;
  private panStartX  = 0;
  private panStartY  = 0;
  private panOriginX = 0;
  private panOriginY = 0;
  private spaceHeld  = false;

  // ── draw tool state (MVP-26) ─────────────────────────────────────────────

  private drawState: {
    tool: 'rect' | 'ellipse' | 'polygon';
    startX: number;
    startY: number;
    curX: number;
    curY: number;
  } | null = null;

  /** Last-used polygon parameters — persist between draws (MVP-59). */
  activeSides = 3;
  activeVariation = 0;

  /**
   * SVG `points` attribute for a polygon/star inscribed in [0..w] × [0..h].
   * variation 0 = regular polygon; >0 alternates outer/inner points (star).
   */
  polygonPoints(w: number, h: number, sides: number, variation: number): string {
    const cx = w / 2;
    const cy = h / 2;
    const rx = w / 2;
    const ry = h / 2;
    const irx = rx * (1 - variation);
    const iry = ry * (1 - variation);
    const points: string[] = [];
    const useInner = variation > 0.001;
    const total = useInner ? sides * 2 : sides;
    for (let i = 0; i < total; i++) {
      const angle = (i / total) * 2 * Math.PI - Math.PI / 2;
      const isOuter = !useInner || i % 2 === 0;
      const ex = isOuter ? rx : irx;
      const ey = isOuter ? ry : iry;
      points.push(`${(cx + ex * Math.cos(angle)).toFixed(2)},${(cy + ey * Math.sin(angle)).toFixed(2)}`);
    }
    return points.join(' ');
  }

  get drawPreview(): {
    tool: 'rect' | 'ellipse' | 'polygon';
    x: number; y: number; w: number; h: number;
  } | null {
    if (!this.drawState) return null;
    const ds = this.drawState;
    return {
      tool: ds.tool,
      x: Math.min(ds.startX, ds.curX),
      y: Math.min(ds.startY, ds.curY),
      w: Math.abs(ds.curX - ds.startX),
      h: Math.abs(ds.curY - ds.startY),
    };
  }

  // ── selection marquee (MVP-42) ─────────────────────────────────────────
  // start/cur are viewport-relative client px; canvas coords for hit-testing.

  private marqueeState: {
    startX: number;
    startY: number;
    startCanvasX: number;
    startCanvasY: number;
    curX: number;
    curY: number;
  } | null = null;

  get marqueeRect(): { x: number; y: number; w: number; h: number } | null {
    if (!this.marqueeState) return null;
    const ms = this.marqueeState;
    return {
      x: Math.min(ms.startX, ms.curX),
      y: Math.min(ms.startY, ms.curY),
      w: Math.abs(ms.curX - ms.startX),
      h: Math.abs(ms.curY - ms.startY),
    };
  }

  private readonly destroyRef = inject(DestroyRef);

  get panningFlag(): boolean { return this.panning; }
  get spaceHeldFlag(): boolean { return this.spaceHeld; }
  get workspaceTransform(): string {
    return `translate(${this.panX}px, ${this.panY}px) scale(${this.zoom})`;
  }

  ngAfterViewInit(): void {
    const el = this.viewportEl.nativeElement;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      this.zoomAtCursor(e.deltaY < 0 ? 1.1 : 1 / 1.1, e.clientX, e.clientY);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    this.destroyRef.onDestroy(() => el.removeEventListener('wheel', onWheel));
    setTimeout(() => this.fitToWindow());
  }

  ngOnDestroy(): void {
    // cleanup handled by destroyRef
  }

  @HostListener('document:keydown', ['$event'])
  onKeyDown(e: KeyboardEvent): void {
    if (isEditableTarget(e.target)) return;
    if ((e.code === 'Delete' || e.code === 'Backspace') && !e.repeat) {
      if (this.store.selection().size > 0) {
        this.deleteSelected();
        e.preventDefault();
      }
      return;
    }
    if (e.ctrlKey || e.metaKey) {
      if (e.code === 'Space' && !e.repeat) {
        this.spaceHeld = true;
        e.preventDefault();
        return;
      }
      switch (e.code) {
        case 'KeyZ':
          if (e.shiftKey) { this.store.redo(); }
          else            { this.store.undo(); }
          e.preventDefault(); return;
        case 'KeyY':
          this.store.redo();
          e.preventDefault(); return;
        case 'KeyS':
          if (e.shiftKey) { void this.fileIo.saveSceneAs(); }
          else            { void this.fileIo.saveScene(); }
          e.preventDefault(); return;
        case 'KeyA':
          this.store.selectAll();
          e.preventDefault(); return;
        case 'KeyC':
          // Copy is handled in the menu bar — no shared clipboard service yet.
          return;
      }
    }
    if (e.ctrlKey || e.metaKey || e.altKey) {
      if (e.code === 'Space' && !e.repeat) {
        this.spaceHeld = true;
        e.preventDefault();
      }
      return;
    }
    if (e.code === 'Space' && !e.repeat) {
      this.spaceHeld = true;
      e.preventDefault();
      return;
    }
    const toolKey: Record<string, ToolId> = {
      KeyV: 'select',
      KeyA: 'move',
      KeyS: 'scale',
      KeyR: 'rotate',
      KeyP: 'pivot',
      KeyH: 'pan',
      KeyM: 'rect',
      KeyL: 'ellipse',
      KeyG: 'polygon',
      KeyT: 'text',
    };
    const tool = toolKey[e.code];
    if (tool) {
      this.toolState.setTool(tool);
      e.preventDefault();
    }
  }

  @HostListener('document:keyup', ['$event'])
  onKeyUp(e: KeyboardEvent): void {
    if (e.code === 'Space') this.spaceHeld = false;
  }

  // ── scale handles (MVP-27) ───────────────────────────────────────────────

  private scaleState: {
    nodeId: string;
    handle: HandlePos;
    startClientX: number;
    startClientY: number;
    origW: number;
    origH: number;
    origX: number;
    origY: number;
  } | null = null;

  scaleHandles(node: SceneNode): Array<{ pos: HandlePos; x: number; y: number }> {
    const w = this.nodeBoundsW(node);
    const h = this.nodeBoundsH(node);
    return [
      { pos: 'nw', x: -4,     y: -4     },
      { pos: 'n',  x: w/2 - 4, y: -4     },
      { pos: 'ne', x: w - 4,  y: -4     },
      { pos: 'e',  x: w - 4,  y: h/2 - 4 },
      { pos: 'se', x: w - 4,  y: h - 4  },
      { pos: 's',  x: w/2 - 4, y: h - 4  },
      { pos: 'sw', x: -4,     y: h - 4  },
      { pos: 'w',  x: -4,     y: h/2 - 4 },
    ];
  }

  onHandlePointerDown(e: PointerEvent, node: SceneNode, handle: HandlePos): void {
    e.stopPropagation();
    if (node.type !== 'primitive' || node.locked) return;
    const p = node as PrimitiveNode;
    this.scaleState = {
      nodeId: node.id,
      handle,
      startClientX: e.clientX,
      startClientY: e.clientY,
      origW: p.w,
      origH: p.h,
      origX: node.transform.x,
      origY: node.transform.y,
    };
    (e.target as Element).setPointerCapture(e.pointerId);
    this.store.beginGesture(this.translate.instant('TOOL.SCALE'));
    e.preventDefault();
  }

  // ── pivot tool (MVP-28) ──────────────────────────────────────────────────

  private pivotState: {
    nodeId: string;
    startClientX: number;
    startClientY: number;
    origPx: number;
    origPy: number;
    r: number;
    sx: number;
    sy: number;
  } | null = null;

  private beginPivotDrag(e: PointerEvent, node: SceneNode): void {
    this.pivotState = {
      nodeId: node.id,
      startClientX: e.clientX,
      startClientY: e.clientY,
      origPx: node.transform.px,
      origPy: node.transform.py,
      r:      node.transform.r,
      sx:     node.transform.sx,
      sy:     node.transform.sy,
    };
    this.viewportEl.nativeElement.setPointerCapture(e.pointerId);
    this.store.beginGesture(this.translate.instant('TOOL.PIVOT'));
    e.preventDefault();
  }

  // ── rotate tool (MVP-31) ─────────────────────────────────────────────────

  private rotateState: {
    originX: number;
    originY: number;
    startAngle: number;
    nodes: Array<{
      id: string;
      origR: number;
      origX: number;
      origY: number;
      origCx: number;
      origCy: number;
    }>;
  } | null = null;

  private nodeCentreCanvas(node: SceneNode): { x: number; y: number } {
    return {
      x: node.transform.x + this.nodeBoundsW(node) / 2,
      y: node.transform.y + this.nodeBoundsH(node) / 2,
    };
  }

  private beginRotateFromEvent(
    startClientX: number,
    startClientY: number,
  ): void {
    const selected = this.store.scene().nodes
      .filter(n => this.store.selection().has(n.id) && !n.locked);
    if (selected.length === 0) return;

    // Single selection: rotate around the node's own pivot (x+px, y+py).
    // Multi-selection: rotate around the average bounding-box centre.
    let cx: number;
    let cy: number;
    if (selected.length === 1) {
      cx = selected[0].transform.x;
      cy = selected[0].transform.y;
    } else {
      cx = selected.reduce((s, n) => s + this.nodeCentreCanvas(n).x, 0) / selected.length;
      cy = selected.reduce((s, n) => s + this.nodeCentreCanvas(n).y, 0) / selected.length;
    }

    const r = this.viewportEl.nativeElement.getBoundingClientRect();
    const px = (startClientX - r.left - this.panX) / this.zoom;
    const py = (startClientY - r.top  - this.panY) / this.zoom;

    this.rotateState = {
      originX: cx,
      originY: cy,
      startAngle: Math.atan2(py - cy, px - cx),
      nodes: selected.map(n => {
        const oc = this.nodeCentreCanvas(n);
        return {
          id:     n.id,
          origR:  n.transform.r,
          origX:  n.transform.x,
          origY:  n.transform.y,
          origCx: oc.x,
          origCy: oc.y,
        };
      }),
    };
    this.store.beginGesture(this.translate.instant('TOOL.ROTATE'));
  }

  private promotePendingToDrag(
    pa: NonNullable<typeof this.pendingAction>,
    captureTarget: Element,
    pointerId: number,
  ): void {
    const selected = this.store.scene().nodes
      .filter(n => this.store.selection().has(n.id) && !n.locked);
    if (selected.length === 0) return;

    captureTarget.setPointerCapture(pointerId);

    if (pa.tool === 'move') {
      const target = pa.nodeId
        ? selected.find(n => n.id === pa.nodeId) ?? selected[0]
        : selected[0];
      this.dragging       = true;
      this.dragStartX     = pa.startClientX;
      this.dragStartY     = pa.startClientY;
      this.dragNodeId     = target.id;
      this.startTransform = { ...target.transform };
      this.store.beginGesture(this.translate.instant('TOOL.MOVE'));
    } else if (pa.tool === 'rotate') {
      this.beginRotateFromEvent(pa.startClientX, pa.startClientY);
    } else if (pa.tool === 'scale') {
      const target = pa.nodeId
        ? selected.find(n => n.id === pa.nodeId) ?? selected[0]
        : selected[0];
      this.scaleXYState = {
        nodeId:       target.id,
        startClientX: pa.startClientX,
        startClientY: pa.startClientY,
        origSx:       target.transform.sx,
        origSy:       target.transform.sy,
        refSize:      Math.max(this.nodeBoundsW(target), this.nodeBoundsH(target), 1),
      };
      this.store.beginGesture(this.translate.instant('TOOL.SCALE'));
    }
  }

  // ── pending action (MVP-34) ──────────────────────────────────────────────

  private pendingAction: {
    tool: 'move' | 'scale' | 'rotate';
    startClientX: number;
    startClientY: number;
    nodeId: string | null;
    wasSelected: boolean;
  } | null = null;

  private readonly DRAG_THRESHOLD = 4;

  // ── scale transform tool (MVP-32) ────────────────────────────────────────

  private scaleXYState: {
    nodeId: string;
    startClientX: number;
    startClientY: number;
    origSx: number;
    origSy: number;
    refSize: number;
  } | null = null;

  private clampScale(val: number): number {
    // Clamp magnitude to a min of 0.01 while keeping the sign (flips) intact
    return Math.sign(val) * Math.max(Math.abs(val), 0.01) || 0.01;
  }

  getScaleNode(): SceneNode | null {
    if (!this.scaleXYState) return null;
    return this.store.scene().nodes.find(n => n.id === this.scaleXYState!.nodeId) ?? null;
  }

  get scaleXYActive(): boolean {
    return this.scaleXYState !== null;
  }

  onViewportPointerDown(e: PointerEvent): void {
    if (e.button === 1) { this.beginPan(e); return; }
    if (e.button !== 0) return;
    if (this.toolState.activeTool() === 'pan' || this.spaceHeld) {
      this.beginPan(e);
      return;
    }
    const tool = this.toolState.activeTool();
    if (tool === 'pivot' && this.store.selection().size === 1) {
      const [id] = this.store.selection();
      const node = this.store.findNode(id);
      if (node) {
        this.beginPivotDrag(e, node);
        return;
      }
    }
    if (tool === 'text') {
      this.placeTextNodeAt(e);
      e.preventDefault();
      return;
    }
    if (tool === 'rect' || tool === 'ellipse' || tool === 'polygon') {
      const r = this.viewportEl.nativeElement.getBoundingClientRect();
      const sx = (e.clientX - r.left - this.panX) / this.zoom;
      const sy = (e.clientY - r.top  - this.panY) / this.zoom;
      this.drawState = { tool, startX: sx, startY: sy, curX: sx, curY: sy };
      (e.currentTarget as Element).setPointerCapture(e.pointerId);
      e.preventDefault();
      return;
    }
    if (tool === 'select' && !this.isNodeTarget(e)) {
      // Marquee starts on the viewport background too (MVP-69) — the
      // pointer may begin in the grey area outside the SVG element.
      this.startMarquee(e);
      return;
    }
  }

  private isNodeTarget(e: PointerEvent): boolean {
    return !!(e.target as Element)?.closest?.('.hit-area, .scale-handle');
  }

  private startMarquee(e: PointerEvent): void {
    const r = this.viewportEl.nativeElement.getBoundingClientRect();
    this.marqueeState = {
      startX:       e.clientX - r.left,
      startY:       e.clientY - r.top,
      startCanvasX: (e.clientX - r.left - this.panX) / this.zoom,
      startCanvasY: (e.clientY - r.top  - this.panY) / this.zoom,
      curX:         e.clientX - r.left,
      curY:         e.clientY - r.top,
    };
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    e.preventDefault();
  }

  private placeTextNodeAt(e: PointerEvent): void {
    const r = this.viewportEl.nativeElement.getBoundingClientRect();
    const x = (e.clientX - r.left - this.panX) / this.zoom;
    const y = (e.clientY - r.top  - this.panY) / this.zoom;
    const node = defaultTextNode(x, y);
    this.store.addNodes([node], 'Add Text');
    // Auto-select the placed text node so its properties are editable
    // immediately. The text tool stays active (MVP-52).
    this.store.setSelected(new Set([node.id]));
  }

  private beginPan(e: PointerEvent): void {
    this.panning    = true;
    this.panStartX  = e.clientX;
    this.panStartY  = e.clientY;
    this.panOriginX = this.panX;
    this.panOriginY = this.panY;
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    e.preventDefault();
  }

  private zoomAtCursor(factor: number, clientX: number, clientY: number): void {
    const el = this.viewportEl.nativeElement;
    const rect = el.getBoundingClientRect();
    const cx = clientX - rect.left;
    const cy = clientY - rect.top;
    const newZoom = this.clampZoom(this.zoom * factor);
    const ratio = newZoom / this.zoom;
    this.panX = cx - (cx - this.panX) * ratio;
    this.panY = cy - (cy - this.panY) * ratio;
    this.zoom = newZoom;
    this.zoomLevel = Math.round(newZoom * 100);
  }

  onZoomInput(value: number): void {
    if (!isFinite(value)) return;
    this.setZoom(value / 100);
  }

  onZoomPreset(value: number | null): void {
    if (value === 0) { this.fitToWindow(); return; }
    if (value) this.setZoom(value / 100);
  }

  setZoom(newZoom: number): void {
    const el = this.viewportEl.nativeElement;
    const cx = el.clientWidth / 2;
    const cy = el.clientHeight / 2;
    const clamped = this.clampZoom(newZoom);
    const ratio = clamped / this.zoom;
    this.panX = cx - (cx - this.panX) * ratio;
    this.panY = cy - (cy - this.panY) * ratio;
    this.zoom = clamped;
    this.zoomLevel = Math.round(clamped * 100);
  }

  fitToWindow(): void {
    const el = this.viewportEl.nativeElement;
    if (!el) return;
    const cw = this.canvasWidth();
    const ch = this.canvasHeight();
    if (!cw || !ch) return;
    const newZoom = Math.max(this.MinZoom,
      Math.min(el.clientWidth / cw, el.clientHeight / ch) * 0.9);
    this.zoom = newZoom;
    this.panX = (el.clientWidth  - cw * newZoom) / 2;
    this.panY = (el.clientHeight - ch * newZoom) / 2;
    this.zoomLevel = Math.round(newZoom * 100);
  }

  resetZoom(): void {
    this.setZoom(1);
    const el = this.viewportEl.nativeElement;
    if (!el) return;
    this.panX = (el.clientWidth  - this.canvasWidth())  / 2;
    this.panY = (el.clientHeight - this.canvasHeight()) / 2;
  }

  private clampZoom(v: number): number {
    return Math.min(this.MaxZoom, Math.max(this.MinZoom, v));
  }

  canvasWidth  = computed(() => this.store.scene().canvas.width);
  canvasHeight = computed(() => this.store.scene().canvas.height);

  clipCanvas = true;

  // MVP-82: consume one-shot zoom actions queued by the View menu.
  private readonly viewActionEffect = effect(() => {
    const action = this.viewState.zoomAction();
    if (!action) return;
    switch (action) {
      case 'in': this.setZoom(this.zoom * 1.25); break;
      case 'out': this.setZoom(this.zoom / 1.25); break;
      case 'reset': this.resetZoom(); break;
      case 'fit': this.fitToWindow(); break;
    }
  });

  private _lastReinjectTick = 0;

  private readonly renderEffect = effect(() => {
    this.svgCache.loadedCount();
    const tick = this.store.svgReinjectTick();
    if (tick !== this._lastReinjectTick) {
      this._lastReinjectTick = tick;
      this.clearSvgRenderedMarkers();
    }
    const queue: Array<[string, string, SceneNode]> = [];
    this.walkAssets(this.store.scene().nodes, queue);
    this.injectSvgQueue(queue);
    // Retry after one macrotask to catch elements not yet in the DOM
    // after a scene load (effects fire before change detection renders
    // the new @for items). Already-injected elements are skipped via
    // data-svg-rendered, so this is idempotent.
    if (queue.length > 0) {
      setTimeout(() => {
        this.injectSvgQueue(queue);
        this.applyMultiColorOverrides(this.store.scene().nodes);
      }, 0);
    }
    this.applyMultiColorOverrides(this.store.scene().nodes);
  });

  private clearSvgRenderedMarkers(): void {
    const queue: Array<[string, string, SceneNode]> = [];
    this.walkAssets(this.store.scene().nodes, queue);
    for (const [elId] of queue) {
      document.getElementById(elId)?.removeAttribute('data-svg-rendered');
    }
  }

  private injectSvgQueue(queue: Array<[string, string, SceneNode]>, retry = false): void {
    let anyMissing = false;
    for (const [elId, assetId] of queue) {
      if (!this.svgCache.has(assetId)) {
        void this.svgCache.fetchOne(assetId);
        continue;
      }
      const el = document.getElementById(elId);
      if (!el) {
        anyMissing = true;
        continue;
      }
      if (el.hasAttribute('data-svg-rendered')) continue;
      const frag = this.svgCache.getSvgClone(assetId);
      if (!frag) continue;
      while (el.firstChild) el.removeChild(el.firstChild);
      el.appendChild(frag);
      el.setAttribute('data-svg-rendered', '1');
    }
    if (anyMissing && !retry) {
      setTimeout(() => this.injectSvgQueue(queue, true));
    }
  }

  ngOnInit(): void {
    const ids = [...new Set(collectAssetIdsRec(this.store.scene().nodes))];
    void this.svgCache.prefetch(ids);
  }

  svgLoaded(node: SceneNode): boolean {
    this.svgCache.loadedCount();
    if (node.type !== 'svg-object' && node.type !== 'multicolor-object') return false;
    return this.svgCache.has((node as SvgObjectNode).assetId);
  }

  private walkAssets(nodes: SceneNode[], out: Array<[string, string, SceneNode]>): void {
    for (const n of nodes) {
      if (n.type === 'svg-object' || n.type === 'multicolor-object') {
        out.push(['asset-' + n.id, (n as SvgObjectNode | MultiColorObjectNode).assetId, n]);
      } else if (n.type === 'group') {
        this.walkAssets(n.nodes, out);
      }
    }
  }

  private applyMultiColorOverrides(nodes: SceneNode[]): void {
    for (const node of nodes) {
      if (node.type === 'group') {
        this.applyMultiColorOverrides((node as GroupNode).nodes);
        continue;
      }
      if (node.type !== 'multicolor-object') continue;
      const mc = node as MultiColorObjectNode;
      const host = document.getElementById('asset-' + mc.id);
      if (!host) continue;
      applyMultiColorPartOverrides(host, mc.parts);
    }
  }

  private dragging       = false;
  private dragStartX     = 0;
  private dragStartY     = 0;
  private dragNodeId     = '';
  private startTransform: Transform | null = null;

  get viewportScale(): number { return this.zoom; }

  constructor(
    readonly store: SceneStore,
    readonly toolState: ToolStateService,
    readonly svgCache: SvgCacheService,
    readonly translate: TranslateService,
    readonly bounds: NodeBoundsService,
    readonly fileIo: FileIoService,
    readonly viewState: ViewStateService,
  ) {}

  // ── context menu (MVP-24) ────────────────────────────────────────────────

  @ViewChild('ctxTrigger') ctxTrigger!: MatMenuTrigger;
  ctxMenuX = -9999;
  ctxMenuY = -9999;

  onContextMenu(e: MouseEvent): void {
    e.preventDefault();
    this.ctxMenuX = e.clientX;
    this.ctxMenuY = e.clientY;
    this.ctxTrigger.closeMenu();
    setTimeout(() => this.ctxTrigger.openMenu());
  }

  setTool(id: string): void {
    this.toolState.setTool(id as ToolId);
  }

  deleteSelected(): void {
    this.store.removeNodes(this.store.selection());
  }

  moveToBack():  void { this.store.toBack(this.store.selection()); }
  moveToFront(): void { this.store.toFront(this.store.selection()); }
  moveDown():    void { this.store.moveDown(this.store.selection()); }
  moveUp():      void { this.store.moveUp(this.store.selection()); }

  cloneSelected(): void {
    this.store.cloneSelected();
  }

  groupSelected(): void {
    this.store.groupSelected();
  }

  ungroupSelected(): void {
    this.store.ungroup(this.store.selection());
  }

  hasGroupSelected(): boolean {
    return this.store.scene().nodes.some(
      n => n.type === 'group' && this.store.selection().has(n.id)
    );
  }

  flipHSelected(): void {
    this.store.flipH(this.store.selection());
  }

  flipVSelected(): void {
    this.store.flipV(this.store.selection());
  }

  hasUnlockedSelected(): boolean {
    const sel = this.store.selection();
    return this.store.scene().nodes.some(n => sel.has(n.id) && !n.locked);
  }

  lockSelected(): void {
    const ids = new Set(
      [...this.store.selection()].filter(id => {
        const n = this.store.scene().nodes.find(x => x.id === id);
        return n && !n.locked;
      })
    );
    if (ids.size > 0) this.store.lockNodes(ids);
  }

  // ── helpers ──────────────────────────────────────────────────────────────

  cssColor(c: Color | null | undefined): string {
    if (!c) return 'none';
    return `rgb(${c[0]},${c[1]},${c[2]})`;
  }

  nodeTransform(node: SceneNode): string {
    return toSvgTransform(node.transform);
  }

  /**
   * World-space pivot anchors for every selected, visible node at any nesting
   * depth (MVP-58). Group children compose their parent chain's transforms.
   */
  pivotMarkers(): Array<{ node: SceneNode; x: number; y: number }> {
    const result: Array<{ node: SceneNode; x: number; y: number }> = [];
    const walk = (nodes: SceneNode[], parent: Mat3) => {
      for (const n of nodes) {
        if (this.store.selection().has(n.id)) {
          const p = applyMatrixPoint(parent, n.transform.x, n.transform.y);
          result.push({ node: n, x: p.x, y: p.y });
        }
        if (n.type === 'group') {
          walk((n as GroupNode).nodes, multiplyMat(parent, toMatrix(n.transform)));
        }
      }
    };
    walk(this.store.scene().nodes, IDENTITY_MAT3);
    return result;
  }

  asPrimitive(n: SceneNode)     { return n as PrimitiveNode; }
  asText(n: SceneNode)          { return n as TextNode; }
  asSvgObject(n: SceneNode)     { return n as SvgObjectNode; }
  asMulticolor(n: SceneNode)    { return n as MultiColorObjectNode; }
  asGroup(n: SceneNode)         { return n as GroupNode; }

  // ── selection (MVP-14) ───────────────────────────────────────────────────

  onCanvasPointerDown(e: PointerEvent): void {
    const el = e.target as Element;
    const isBackground =
      el.classList.contains('scene-svg') || el.classList.contains('background');
    if (!isBackground) return;

    if (e.button !== 0) return;

    const tool = this.toolState.activeTool();

    if (tool === 'pivot' && this.store.selection().size === 1) {
      const [id] = this.store.selection();
      const node = this.store.findNode(id);
      if (node) {
        this.beginPivotDrag(e, node);
        return;
      }
    }

    if ((tool === 'move' || tool === 'scale' || tool === 'rotate')
        && this.store.selection().size > 0) {
      // Drag on empty canvas with a selection — defer so drag moves selection,
      // click clears it.
      this.pendingAction = {
        tool,
        startClientX: e.clientX,
        startClientY: e.clientY,
        nodeId: null,
        wasSelected: false,
      };
      (e.currentTarget as Element).setPointerCapture(e.pointerId);
      e.preventDefault();
      return;
    }

    if (tool === 'select') {
      // Marquee: drag draws a rubber band; a plain click (< threshold)
      // clears the selection on pointerup.
      this.startMarquee(e);
      return;
    }

    this.store.clearSelection();
  }

  onNodePointerDown(e: PointerEvent, node: SceneNode): void {
    const tool = this.toolState.activeTool();

    // Draw tools can start over any node — do not stopPropagation so the
    // event bubbles to the viewport handler which begins the draw/placement.
    if (tool === 'rect' || tool === 'ellipse' || tool === 'text') {
      return;
    }

    e.stopPropagation();
    if (e.button === 1) { this.beginPan(e); return; }
    if (e.button !== 0) return;

    // Pan tool (and space-held temporary pan) takes priority over everything
    if (tool === 'pan' || this.spaceHeld) {
      this.beginPan(e);
      return;
    }

    if (node.locked) return;

    const alreadySelected = this.store.selection().has(node.id);

    if (tool === 'pivot') {
      // Clicking anywhere on a node with the pivot tool starts a pivot drag
      this.store.setSelected(new Set([node.id]));
      this.beginPivotDrag(e, node);
      return;
    }

    if (tool === 'move' || tool === 'scale' || tool === 'rotate') {
      if (e.shiftKey) {
        this.store.toggleSelected(node.id);
        return; // shift-click is always selection only, never a drag
      }
      // Defer selection change until pointerup so that dragging on an
      // unselected node moves the current selection rather than replacing it.
      // If the threshold is never crossed (click), pointerup will re-select.
      if (!alreadySelected && this.store.selection().size === 0) {
        // Nothing selected at all — select this node immediately so the drag
        // has something to work with.
        this.store.setSelected(new Set([node.id]));
      }
      this.pendingAction = {
        tool,
        startClientX: e.clientX,
        startClientY: e.clientY,
        nodeId: node.id,
        wasSelected: alreadySelected,
      };
      (e.target as Element).setPointerCapture(e.pointerId);
      e.preventDefault();
      return;
    }

    if (tool === 'select') {
      if (e.shiftKey) {
        this.store.toggleSelected(node.id);
      } else {
        this.store.setSelected(new Set([node.id]));
      }
    }
  }

  onPointerMove(e: PointerEvent): void {
    if (this.marqueeState) {
      const r = this.viewportEl.nativeElement.getBoundingClientRect();
      this.marqueeState = {
        ...this.marqueeState,
        curX: e.clientX - r.left,
        curY: e.clientY - r.top,
      };
      return;
    }
    if (this.pendingAction) {
      const pa = this.pendingAction;
      const dist = Math.hypot(
        e.clientX - pa.startClientX,
        e.clientY - pa.startClientY,
      );
      if (dist >= this.DRAG_THRESHOLD) {
        this.pendingAction = null;
        this.promotePendingToDrag(pa, e.currentTarget as Element, e.pointerId);
      }
      return;
    }
    if (this.panning) {
      this.panX = this.panOriginX + (e.clientX - this.panStartX);
      this.panY = this.panOriginY + (e.clientY - this.panStartY);
      return;
    }
    if (this.drawState) {
      const r = this.viewportEl.nativeElement.getBoundingClientRect();
      this.drawState = {
        ...this.drawState,
        curX: (e.clientX - r.left - this.panX) / this.zoom,
        curY: (e.clientY - r.top  - this.panY) / this.zoom,
      };
      return;
    }
    if (this.scaleState) {
      const ss = this.scaleState;
      const dx = (e.clientX - ss.startClientX) / this.zoom;
      const dy = (e.clientY - ss.startClientY) / this.zoom;
      const handle = ss.handle;

      let newW = ss.origW;
      let newH = ss.origH;
      let newX = ss.origX;
      let newY = ss.origY;

      if (handle === 'e' || handle === 'ne' || handle === 'se') {
        newW = Math.max(4, ss.origW + dx);
      }
      if (handle === 'w' || handle === 'nw' || handle === 'sw') {
        newW = Math.max(4, ss.origW - dx);
        newX = ss.origX + ss.origW - newW;
      }

      if (handle === 's' || handle === 'se' || handle === 'sw') {
        newH = Math.max(4, ss.origH + dy);
      }
      if (handle === 'n' || handle === 'nw' || handle === 'ne') {
        newH = Math.max(4, ss.origH - dy);
        newY = ss.origY + ss.origH - newH;
      }

      if (e.shiftKey && (handle === 'nw' || handle === 'ne' || handle === 'se' || handle === 'sw')) {
        const ratio = ss.origW / ss.origH;
        if (Math.abs(newW - ss.origW) >= Math.abs(newH - ss.origH)) {
          newH = newW / ratio;
        } else {
          newW = newH * ratio;
        }
      }

      this.store.updateNode(ss.nodeId, n => ({
        ...n,
        w: newW,
        h: newH,
        transform: { ...n.transform, x: newX, y: newY },
      } as SceneNode));
      return;
    }
    if (this.pivotState) {
      const ps = this.pivotState;
      const wdx = (e.clientX - ps.startClientX) / this.zoom;
      const wdy = (e.clientY - ps.startClientY) / this.zoom;
      // x/y (pivot dot world position) NEVER changes during a pivot drag.
      // Content offset (px,py) is in post-rotate post-scale local space.
      // Convert world-space drag delta to local space to get the new offset.
      const cos = Math.cos(ps.r);
      const sin = Math.sin(ps.r);
      const ldx = ( wdx * cos + wdy * sin) / ps.sx;
      const ldy = (-wdx * sin + wdy * cos) / ps.sy;
      const node = this.store.findNode(ps.nodeId);
      if (node) {
        this.store.updateTransform(ps.nodeId, {
          ...node.transform,
          px: ps.origPx + ldx,
          py: ps.origPy + ldy,
        });
      }
      return;
    }
    if (this.rotateState) {
      const rs = this.rotateState;
      const r = this.viewportEl.nativeElement.getBoundingClientRect();
      const px = (e.clientX - r.left - this.panX) / this.zoom;
      const py = (e.clientY - r.top  - this.panY) / this.zoom;
      let angle = Math.atan2(py - rs.originY, px - rs.originX) - rs.startAngle;
      if (e.shiftKey) angle = Math.round(angle / (15 * DEG2RAD)) * 15 * DEG2RAD;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      const singleNode = rs.nodes.length === 1;
      for (const nd of rs.nodes) {
        this.store.updateNode(nd.id, n => {
          if (singleNode) {
            // Single node: x/y IS the rotation origin — only r changes.
            // The SVG chain translate(x,y) rotate(r) handles the rest.
            return {
              ...n,
              transform: { ...n.transform, r: nd.origR + angle },
            } as SceneNode;
          }
          // Multi-node: orbit each node's pivot (x,y) around the group centre.
          const dx = nd.origX - rs.originX;
          const dy = nd.origY - rs.originY;
          const rx = dx * cos - dy * sin + rs.originX;
          const ry = dx * sin + dy * cos + rs.originY;
          return {
            ...n,
            transform: {
              ...n.transform,
              r: nd.origR + angle,
              x: rx,
              y: ry,
            },
          } as SceneNode;
        });
      }
      return;
    }
    if (this.scaleXYState) {
      const ss = this.scaleXYState;
      const dx = (e.clientX - ss.startClientX) / this.zoom;
      const dy = (e.clientY - ss.startClientY) / this.zoom;

      // Right = scale up X, left = scale down X; down = scale up Y, up = scale down Y
      let newSx = ss.origSx * (1 + dx / ss.refSize);
      let newSy = ss.origSy * (1 + dy / ss.refSize);

      newSx = this.clampScale(newSx);
      newSy = this.clampScale(newSy);

      // Shift = uniform scale (lock aspect ratio)
      if (e.shiftKey) {
        const factorX = newSx / Math.abs(ss.origSx);
        const factorY = newSy / Math.abs(ss.origSy);
        const factor  = Math.abs(dx) >= Math.abs(dy) ? factorX : factorY;
        newSx = this.clampScale(ss.origSx * factor);
        newSy = this.clampScale(ss.origSy * factor);
      }

      const node = this.store.scene().nodes.find(n => n.id === ss.nodeId);
      if (node) {
        this.store.updateTransform(ss.nodeId, {
          ...node.transform,
          sx: newSx,
          sy: newSy,
        });
      }
      return;
    }
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
    if (this.marqueeState) {
      const ms = this.marqueeState;
      this.marqueeState = null;
      const dist = Math.hypot(ms.curX - ms.startX, ms.curY - ms.startY);
      if (dist < this.DRAG_THRESHOLD) {
        this.store.clearSelection();
        return;
      }
      const endCanvasX = (ms.curX - this.panX) / this.zoom;
      const endCanvasY = (ms.curY - this.panY) / this.zoom;
      const selX = Math.min(ms.startCanvasX, endCanvasX);
      const selY = Math.min(ms.startCanvasY, endCanvasY);
      const selW = Math.abs(endCanvasX - ms.startCanvasX);
      const selH = Math.abs(endCanvasY - ms.startCanvasY);
      const hits = this.store.scene().nodes.filter(n => {
        if (n.locked || n.visible === false) return false;
        const bx = n.transform.x;
        const by = n.transform.y;
        const bw = this.nodeBoundsW(n);
        const bh = this.nodeBoundsH(n);
        // Intersects if neither rect is fully outside the other.
        return bx < selX + selW && bx + bw > selX && by < selY + selH && by + bh > selY;
      });
      if (hits.length > 0) {
        this.store.setSelected(new Set(hits.map(n => n.id)));
      } else {
        this.store.clearSelection();
      }
      return;
    }
    if (this.pendingAction) {
      const pa = this.pendingAction;
      this.pendingAction = null;
      // Released without crossing drag threshold — treat as a click.
      if (pa.nodeId) {
        if (pa.wasSelected) {
          // Already selected: isolate to just this node.
          this.store.setSelected(new Set([pa.nodeId]));
        } else {
          // Clicked an unselected node without dragging — select it now.
          this.store.setSelected(new Set([pa.nodeId]));
        }
      } else {
        // Clicked on empty canvas without dragging — clear selection.
        this.store.clearSelection();
      }
      return;
    }
    if (this.panning) {
      this.panning = false;
      return;
    }
    if (this.scaleState) {
      this.scaleState = null;
      this.store.endGesture();
      return;
    }
    if (this.pivotState) {
      this.pivotState = null;
      this.store.endGesture();
      return;
    }
    if (this.rotateState) {
      this.rotateState = null;
      this.store.endGesture();
      return;
    }
    if (this.scaleXYState) {
      this.scaleXYState = null;
      this.store.endGesture();
      return;
    }
    if (this.drawState) {
      const ds = this.drawState;
      this.drawState = null;
      const x = Math.min(ds.startX, ds.curX);
      const y = Math.min(ds.startY, ds.curY);
      const w = Math.abs(ds.curX - ds.startX);
      const h = Math.abs(ds.curY - ds.startY);
      if (w >= 4 && h >= 4) {
        const label = ds.tool === 'rect'
          ? this.translate.instant('NODE_TYPE.PRIMITIVE_RECT')
          : ds.tool === 'ellipse'
            ? this.translate.instant('NODE_TYPE.PRIMITIVE_ELLIPSE')
            : this.translate.instant('NODE_TYPE.PRIMITIVE_POLYGON');
        const nodeId = crypto.randomUUID();
        this.store.addNode({
          id: nodeId,
          type: 'primitive',
          label,
          shape: ds.tool === 'rect' ? 'rect' : ds.tool === 'ellipse' ? 'ellipse' : 'polygon',
          w, h,
          ...(ds.tool === 'polygon'
            ? { sides: this.activeSides, variation: this.activeVariation }
            : {}),
          fill: [255, 255, 255],
          stroke: [100, 100, 100],
          strokeWidth: 1,
          transform: { ...IDENTITY_TRANSFORM, x: x + w / 2, y: y + h / 2, px: -w / 2, py: -h / 2 },
          visible: true,
          locked: false,
        });
        // Auto-select the new node (addNode does this, kept explicit).
        // Do NOT switch tools — the draw tool stays active (MVP-52).
        this.store.setSelected(new Set([nodeId]));
      }
      return;
    }
    if (!this.dragging) return;
    this.dragging       = false;
    this.startTransform = null;
    this.store.endGesture();
  }

  onSidesStatusChange(v: string): void {
    this.activeSides = Math.round(Math.min(32, Math.max(3, +v)));
  }

  onVariationStatusChange(v: string): void {
    this.activeVariation = Math.min(1, Math.max(0, +v));
  }

  nodeBoundsW(node: SceneNode): number {
    return this.bounds.w(node);
  }

  nodeBoundsH(node: SceneNode): number {
    return this.bounds.h(node);
  }

  nodeBoundsX(node: SceneNode): number {
    return this.bounds.x(node);
  }

  nodeBoundsY(node: SceneNode): number {
    return this.bounds.y(node);
  }
}
