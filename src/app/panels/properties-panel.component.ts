import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatDividerModule } from '@angular/material/divider';
import { TranslateModule } from '@ngx-translate/core';
import { SceneStore } from '../core/scene-store';
import { CatalogService } from '../core/catalog.service';
import {
  Color,
  PrimitiveNode,
  SceneNode,
  TextNode,
  GroupNode,
  MultiColorObjectNode,
} from '../core/models';
import { DEG2RAD, RAD2DEG } from '../core/transform-math';
import { FONTS } from '../core/fonts';

@Component({
  selector: 'app-properties-panel',
  standalone: true,
  imports: [
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatButtonModule,
    MatIconModule,
    MatTooltipModule,
    MatCheckboxModule,
    MatDividerModule,
    FormsModule,
    TranslateModule,
    CommonModule,
  ],
  templateUrl: './properties-panel.component.html',
  styleUrl: './properties-panel.component.scss',
})
export class PropertiesPanelComponent {
  readonly store = inject(SceneStore);
  readonly catalog = inject(CatalogService);

  // ── selection state ─────────────────────────────────────────────────────────

  readonly fonts = FONTS;

  get hasSelection(): boolean { return this.store.selection().size > 0; }
  get selectionCount(): number { return this.store.selection().size; }
  get isSingleSelection(): boolean { return this.store.selection().size === 1; }
  get selectedNode(): SceneNode | null {
    if (!this.isSingleSelection) return null;
    const [id] = this.store.selection();
    return this.store.scene().nodes.find(n => n.id === id) ?? null;
  }

  asPrimitive(n: SceneNode): PrimitiveNode | null {
    return n && n.type === 'primitive' ? n : null;
  }

  asText(n: SceneNode): TextNode | null {
    return n && n.type === 'text' ? n : null;
  }

  asGroup(n: SceneNode): GroupNode | null {
    return n && n.type === 'group' ? n : null;
  }

  asMultiColor(n: SceneNode): MultiColorObjectNode | null {
    return n && n.type === 'multicolor-object' ? n : null;
  }

  assetName(assetId: string): string {
    return this.catalog.resolve(assetId)?.label ?? assetId;
  }

  assetDescription(assetId: string): string {
    return this.catalog.resolve(assetId)?.description ?? '';
  }

  assetIdOf(n: SceneNode): string | null {
    return n && (n.type === 'svg-object' || n.type === 'multicolor-object') ? n.assetId : null;
  }

  // ── common field handlers (MVP-35) ─────────────────────────────────────────

  private parse(v: string): number | null {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : null;
  }

  onLabelChange(v: string): void {
    const n = this.selectedNode;
    if (!n) return;
    if (v === n.label) return;
    this.store.updateNode(n.id, node => ({ ...node, label: v }));
  }

  onXChange(v: string): void {
    const n = this.selectedNode;
    if (!n) return;
    const val = this.parse(v);
    if (val === null) return;
    this.store.updateTransform(n.id, { ...n.transform, x: val });
  }

  onYChange(v: string): void {
    const n = this.selectedNode;
    if (!n) return;
    const val = this.parse(v);
    if (val === null) return;
    this.store.updateTransform(n.id, { ...n.transform, y: val });
  }

  onRotationChange(v: string): void {
    const n = this.selectedNode;
    if (!n) return;
    const deg = this.parse(v);
    if (deg === null) return;
    this.store.updateTransform(n.id, { ...n.transform, r: deg * DEG2RAD });
  }

  onPivotXChange(v: string): void {
    const n = this.selectedNode;
    if (!n) return;
    const val = this.parse(v);
    if (val === null) return;
    this.store.updateTransform(n.id, { ...n.transform, px: val });
  }

  onPivotYChange(v: string): void {
    const n = this.selectedNode;
    if (!n) return;
    const val = this.parse(v);
    if (val === null) return;
    this.store.updateTransform(n.id, { ...n.transform, py: val });
  }

  // ── primitive handlers ──────────────────────────────────────────────────────

  lockAspect = true;

  onWidthChange(v: string): void {
    const sel = this.selectedNode;
    if (!sel) return;
    const n = this.asPrimitive(sel);
    if (!n) return;
    const w = Math.max(1, this.parse(v) ?? 1);
    const ratio = n.w > 0 ? n.h / n.w : 1;
    const h = this.lockAspect ? w * ratio : n.h;
    this.store.updateNode(n.id, node => ({ ...(node as PrimitiveNode), w, h }));
  }

  onHeightChange(v: string): void {
    const sel = this.selectedNode;
    if (!sel) return;
    const n = this.asPrimitive(sel);
    if (!n) return;
    const h = Math.max(1, this.parse(v) ?? 1);
    const ratio = n.h > 0 ? n.w / n.h : 1;
    const w = this.lockAspect ? h * ratio : n.w;
    this.store.updateNode(n.id, node => ({ ...(node as PrimitiveNode), w, h }));
  }

  onSidesChange(v: string): void {
    const sel = this.selectedNode;
    if (!sel) return;
    const n = this.asPrimitive(sel);
    if (!n || n.shape !== 'polygon') return;
    const sides = Math.round(Math.min(32, Math.max(3, +v)));
    this.store.updateNode(n.id, node => ({ ...(node as PrimitiveNode), sides }));
  }

  onVariationChange(v: string): void {
    const sel = this.selectedNode;
    if (!sel) return;
    const n = this.asPrimitive(sel);
    if (!n || n.shape !== 'polygon') return;
    const variation = Math.min(1, Math.max(0, +v));
    this.store.updateNode(n.id, node => ({ ...(node as PrimitiveNode), variation }));
  }

  onFillChange(v: string | null): void {
    this.onColorChange('fill', v);
  }

  onStrokeChange(v: string): void {
    this.onColorChange('stroke', v);
  }

  private onColorChange(field: 'fill' | 'stroke', v: string | null): void {
    const sel = this.selectedNode;
    if (!sel) return;
    const n = this.asPrimitive(sel);
    if (!n) return;
    const c = v === null ? null : this.hexToColor(v);
    this.store.updateNode(n.id, node => ({ ...(node as PrimitiveNode), [field]: c }));
  }

  toggleFill(): void {
    const sel = this.selectedNode;
    if (!sel) return;
    const n = this.asPrimitive(sel);
    if (!n) return;
    this.onColorChange('fill', n.fill == null ? '#000000' : null);
  }

  toggleStroke(): void {
    const sel = this.selectedNode;
    if (!sel) return;
    const n = this.asPrimitive(sel);
    if (!n) return;
    this.onColorChange('stroke', n.stroke == null ? '#000000' : null);
  }

  onStrokeWidthChange(v: string): void {
    const sel = this.selectedNode;
    if (!sel) return;
    const n = this.asPrimitive(sel);
    if (!n) return;
    const val = Math.max(0, this.parse(v) ?? 0);
    this.store.updateNode(n.id, node => ({ ...(node as PrimitiveNode), strokeWidth: val }));
  }

  // ── text handlers ───────────────────────────────────────────────────────────

  onContentChange(v: string): void {
    const sel = this.selectedNode;
    if (!sel) return;
    const n = this.asText(sel);
    if (!n) return;
    this.store.updateNode(n.id, node => ({ ...(node as TextNode), content: v }));
  }

  onFontChange(v: string): void {
    const sel = this.selectedNode;
    if (!sel) return;
    const n = this.asText(sel);
    if (!n) return;
    this.store.updateNode(n.id, node => ({ ...(node as TextNode), font: v }));
  }

  onFontSizeChange(v: string): void {
    const sel = this.selectedNode;
    if (!sel) return;
    const n = this.asText(sel);
    if (!n) return;
    const val = Math.max(1, this.parse(v) ?? 1);
    this.store.updateNode(n.id, node => ({ ...(node as TextNode), size: val }));
  }

  onFontStyleChange(v: string): void {
    const sel = this.selectedNode;
    if (!sel) return;
    const n = this.asText(sel);
    if (!n) return;
    this.store.updateNode(n.id, node => ({ ...(node as TextNode), style: v as TextNode['style'] }));
  }

  onTextColorChange(v: string | null): void {
    const sel = this.selectedNode;
    if (!sel) return;
    const n = this.asText(sel);
    if (!n) return;
    const c = v === null ? null : this.hexToColor(v);
    this.store.updateNode(n.id, node => ({ ...(node as TextNode), color: c }));
  }

  toggleTextColor(): void {
    const sel = this.selectedNode;
    if (!sel) return;
    const n = this.asText(sel);
    if (!n) return;
    this.onTextColorChange(n.color === null ? '#000000' : null);
  }

  onTextStrokeChange(v: string | null): void {
    const sel = this.selectedNode;
    if (!sel) return;
    const n = this.asText(sel);
    if (!n) return;
    const c = v === null ? null : this.hexToColor(v);
    this.store.updateNode(n.id, node => ({ ...(node as TextNode), stroke: c }));
  }

  toggleTextStroke(): void {
    const sel = this.selectedNode;
    if (!sel) return;
    const n = this.asText(sel);
    if (!n) return;
    this.onTextStrokeChange(n.stroke == null ? '#000000' : null);
  }

  onTextStrokeWidthChange(v: string): void {
    const sel = this.selectedNode;
    if (!sel) return;
    const n = this.asText(sel);
    if (!n) return;
    const w = Math.max(0, parseFloat(v) || 0);
    this.store.updateNode(n.id, node => ({ ...(node as TextNode), strokeWidth: w }));
  }

  // ── multi-color part handlers (MVP-38) ─────────────────────────────────────

  mcParts(assetId: string): Array<{ id: string; label: string }> {
    return this.catalog.resolve(assetId)?.parts ?? [];
  }

  hasOverride(mc: MultiColorObjectNode, partId: string, field: 'fill' | 'stroke'): boolean {
    const p = mc.parts.find(x => x.id === partId);
    return p !== undefined && p[field] !== undefined;
  }

  partFillHex(mc: MultiColorObjectNode, partId: string): string {
    const c = mc.parts.find(p => p.id === partId)?.fill;
    return c ? this.colorToHex(c) : '#000000';
  }

  partStrokeHex(mc: MultiColorObjectNode, partId: string): string {
    const c = mc.parts.find(p => p.id === partId)?.stroke;
    return c ? this.colorToHex(c) : '#000000';
  }

  partStrokeWidth(mc: MultiColorObjectNode, partId: string): number {
    return mc.parts.find(p => p.id === partId)?.strokeWidth ?? 0;
  }

  toggleOverride(partId: string, field: 'fill' | 'stroke', on: boolean): void {
    const sel = this.selectedNode;
    if (!sel) return;
    const n = this.asMultiColor(sel);
    if (!n) return;
    if (field === 'fill') {
      this.store.updateMultiColorPart(n.id, partId, { fill: on ? [0, 0, 0] : undefined });
    } else {
      this.store.updateMultiColorPart(n.id, partId, { stroke: on ? [0, 0, 0] : undefined });
    }
  }

  onPartFillChange(partId: string, hex: string): void {
    const sel = this.selectedNode;
    if (!sel) return;
    const n = this.asMultiColor(sel);
    if (!n) return;
    this.store.updateMultiColorPart(n.id, partId, { fill: this.hexToColor(hex) });
  }

  onPartStrokeChange(partId: string, hex: string): void {
    const sel = this.selectedNode;
    if (!sel) return;
    const n = this.asMultiColor(sel);
    if (!n) return;
    this.store.updateMultiColorPart(n.id, partId, { stroke: this.hexToColor(hex) });
  }

  onPartStrokeWidthChange(partId: string, v: string): void {
    const sel = this.selectedNode;
    if (!sel) return;
    const n = this.asMultiColor(sel);
    if (!n) return;
    const w = parseFloat(v);
    if (!Number.isFinite(w) || w < 0) return;
    this.store.updateMultiColorPart(n.id, partId, { strokeWidth: w });
  }

  resetPart(partId: string): void {
    const sel = this.selectedNode;
    if (!sel) return;
    const n = this.asMultiColor(sel);
    if (!n) return;
    this.store.updateNode(n.id, node => {
      const mc = node as MultiColorObjectNode;
      return { ...mc, parts: mc.parts.filter(p => p.id !== partId) } as SceneNode;
    });
  }

  resetAllParts(): void {
    const sel = this.selectedNode;
    if (!sel) return;
    const n = this.asMultiColor(sel);
    if (!n) return;
    this.store.resetMultiColorParts(n.id);
  }

  // ── helpers ─────────────────────────────────────────────────────────────────

  rotationDeg(n: SceneNode): number {
    return Math.round(n.transform.r * RAD2DEG * 100) / 100;
  }

  colorToHex(c: Color | null | undefined): string {
    if (!c) return '#000000';
    return '#' + c.map(v => v.toString(16).padStart(2, '0')).join('');
  }

  hexToColor(hex: string): Color {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return [r, g, b];
  }
}
