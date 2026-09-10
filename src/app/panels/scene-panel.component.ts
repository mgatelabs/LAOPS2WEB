import { Component, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatDialog } from '@angular/material/dialog';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { ScenesCatalogService, SceneItem, SceneFolder } from '../core/scenes-catalog.service';
import { SceneStore } from '../core/scene-store';
import { FileIoService } from '../core/file-io.service';
import { ConfirmDialogComponent } from '../shared/confirm-dialog.component';
import { LoadingOverlayComponent } from '../shared/loading-overlay.component';

@Component({
  selector: 'app-scene-panel',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatButtonModule,
    MatIconModule,
    MatFormFieldModule,
    MatInputModule,
    MatTooltipModule,
    MatProgressSpinnerModule,
    TranslateModule,
    LoadingOverlayComponent,
  ],
  templateUrl: './scene-panel.component.html',
  styleUrl: './scene-panel.component.scss',
})
export class ScenePanelComponent implements OnInit {
  readonly scenes = inject(ScenesCatalogService);
  readonly store = inject(SceneStore);
  readonly fileIo = inject(FileIoService);
  private readonly dialog = inject(MatDialog);
  private readonly translate = inject(TranslateService);
  searchQuery = '';
  pendingLoad = false;

  private readonly expanded = new Set<string>();

  ngOnInit(): void {
    for (const f of this.scenes.catalog()?.folders ?? []) {
      this.expanded.add(f.id);
    }
  }

  isExpanded(id: string): boolean { return this.expanded.has(id); }

  toggleFolder(id: string): void {
    this.expanded.has(id) ? this.expanded.delete(id) : this.expanded.add(id);
  }

  get isSearching(): boolean { return this.searchQuery.trim().length > 0; }

  get filteredItems(): SceneItem[] {
    const q = this.searchQuery.trim().toLowerCase();
    if (!q) return [];
    return this.scenes.items().filter(i =>
      i.label.toLowerCase().includes(q) ||
      (i.description ?? '').toLowerCase().includes(q)
    );
  }

  async loadScene(item: SceneItem): Promise<void> {
    if (this.fileIo.busy() || this.pendingLoad) return;
    if (this.store.dirty()) {
      const ok = this.dialog.open(ConfirmDialogComponent, {
        data: { message: this.translate.instant('DIALOG.DISCARD_CHANGES') },
      });
      const result = await ok.afterClosed().toPromise();
      if (result !== true) return;
    }
    this.pendingLoad = true;
    try {
      await this.scenes.loadScene(item);
    } finally {
      this.pendingLoad = false;
    }
  }

  async importAsGroup(item: SceneItem): Promise<void> {
    if (this.fileIo.busy() || this.pendingLoad) return;
    this.pendingLoad = true;
    try {
      await this.scenes.importAsGroup(item);
    } finally {
      this.pendingLoad = false;
    }
  }

  getFolders(): SceneFolder[] {
    return this.scenes.catalog()?.folders ?? [];
  }
}
