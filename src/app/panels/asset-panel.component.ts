import { Component, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { TranslateModule } from '@ngx-translate/core';
import { CatalogService, CatalogItem } from '../core/catalog.service';
import { SceneStore } from '../core/scene-store';
import { SvgCacheService } from '../core/svg-cache.service';
import { SceneNode } from '../core/models';
import { newId } from '../core/ids';
import { LoadingOverlayComponent } from '../shared/loading-overlay.component';

@Component({
  selector: 'app-asset-panel',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatIconModule,
    MatTooltipModule,
    MatProgressSpinnerModule,
    TranslateModule,
    LoadingOverlayComponent,
  ],
  templateUrl: './asset-panel.component.html',
  styleUrl: './asset-panel.component.scss',
})
export class AssetPanelComponent implements OnInit {
  readonly catalog = inject(CatalogService);
  private readonly store = inject(SceneStore);
  private readonly svgCache = inject(SvgCacheService);
  readonly loading = signal(false);
  searchQuery = '';

  private readonly expanded = new Set<string>();

  ngOnInit(): void {
    for (const s of this.catalog.catalogue().sections) {
      this.expanded.add(s.id);
    }
  }

  isExpanded(id: string): boolean { return this.expanded.has(id); }

  toggleFolder(id: string): void {
    this.expanded.has(id) ? this.expanded.delete(id) : this.expanded.add(id);
  }

  get isSearching(): boolean { return this.searchQuery.trim().length > 0; }

  addToScene(item: CatalogItem): void {
    if (this.loading()) return;
    this.loading.set(true);
    const canvas = this.store.scene().canvas;
    const x = Math.round(canvas.width  / 2);
    const y = Math.round(canvas.height / 2);
    const t = { x, y, sx: 1, sy: 1, r: 0, px: -32, py: -32 };
    const nodeId = newId();
    const node: SceneNode = item.multiColor
      ? {
          id: nodeId, type: 'multicolor-object', label: item.label,
          assetId: item.id, parts: [],
          transform: t, visible: true, locked: false,
        }
      : {
          id: nodeId, type: 'svg-object', label: item.label,
          assetId: item.id,
          transform: t, visible: true, locked: false,
        };
    this.store.addNode(node);
    void this.svgCache.fetchOne(item.id).then(() => {
      const sz = this.svgCache.getSvgSize(item.id);
      if (!sz) return;
      const current = this.store.scene().nodes.find(n => n.id === nodeId);
      if (!current) return;
      this.store.updateTransform(nodeId, {
        ...current.transform,
        px: -sz.w / 2,
        py: -sz.h / 2,
      });
    }).finally(() => this.loading.set(false));
  }

  get filteredItems(): CatalogItem[] {
    const q = this.searchQuery.trim().toLowerCase();
    if (!q) return [];
    return this.catalog.allItems().filter(i =>
      i.label.toLowerCase().includes(q) ||
      i.tags.some(t => t.toLowerCase().includes(q))
    );
  }
}
