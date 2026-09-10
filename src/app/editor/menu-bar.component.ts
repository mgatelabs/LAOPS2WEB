import { Component, inject, signal } from '@angular/core';
import { MatMenuModule } from '@angular/material/menu';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatSelectModule } from '@angular/material/select';
import { MatDividerModule } from '@angular/material/divider';
import { MatDialogModule, MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatTooltipModule } from '@angular/material/tooltip';
import { FormsModule } from '@angular/forms';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { SettingsService, Theme } from '../core/settings.service';
import { FileIoService } from '../core/file-io.service';
import { SceneStore } from '../core/scene-store';
import { ExportService } from '../core/export.service';
import { ViewStateService } from '../core/view-state.service';
import { SceneNode } from '../core/models';
import { RenameDialogComponent } from '../shared/rename-dialog.component';
import { AboutDialogComponent } from '../shared/about-dialog.component';
import { CanvasSettingsDialogComponent, CanvasSettingsResult } from './canvas-settings-dialog.component';
import { ExportPngDialogComponent, ExportPngResult } from './export-png-dialog.component';

@Component({
  selector: 'app-menu-bar',
  standalone: true,
  imports: [
    MatMenuModule,
    MatButtonModule,
    MatIconModule,
    MatButtonToggleModule,
    MatSelectModule,
    MatDividerModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatTooltipModule,
    FormsModule,
    TranslateModule,
  ],
  templateUrl: './menu-bar.component.html',
  styleUrl: './menu-bar.component.scss',
})
export class MenuBarComponent {
  readonly settings  = inject(SettingsService);
  private readonly dialog    = inject(MatDialog);
  private readonly translate = inject(TranslateService);
  readonly fileIo = inject(FileIoService);
  readonly store  = inject(SceneStore);
  private readonly exportService = inject(ExportService);
  private readonly viewState = inject(ViewStateService);

  // MVP-82: View-menu zoom actions, consumed by CanvasComponent.
  zoomIn(): void { this.viewState.zoomIn(); }
  zoomOut(): void { this.viewState.zoomOut(); }
  zoomReset(): void { this.viewState.zoomReset(); }
  zoomFit(): void { this.viewState.zoomFit(); }

  readonly theme    = this.settings.theme;
  readonly language = this.settings.language;
  readonly locales  = this.settings.locales;

  // in-memory clipboard (MVP-37)
  readonly clipboard = signal<SceneNode[]>([]);

  /** Display name — strips .laops extension */
  get displayName(): string {
    const name = this.fileIo.sceneFileName();
    if (!name) return '';
    return name.replace(/\.laops$/i, '');
  }

  get untitledLabel(): string {
    return this.translate.instant('MENU.UNTITLED');
  }

  openRenameDialog(): void {
    const current = this.displayName;
    const ref = this.dialog.open(RenameDialogComponent, {
      width: '320px',
      data: { name: current },
      autoFocus: true,
    });
    ref.afterClosed().subscribe((result: string | undefined) => {
      if (result === undefined || result === null) return; // cancelled
      const trimmed = result.trim();
      if (trimmed) {
        this.fileIo.sceneFileName.set(trimmed + '.laops');
      }
    });
  }

  openCanvasSettings(): void {
    const ref = this.dialog.open(CanvasSettingsDialogComponent, {
      width: '340px',
      data: { canvas: this.store.scene().canvas },
      autoFocus: true,
    });
    ref.afterClosed().subscribe((result: CanvasSettingsResult | undefined) => {
      if (!result) return; // cancelled
      this.store.updateCanvas(result);
    });
  }

  openExportPng(): void {
    const svgEl = document.querySelector<SVGSVGElement>('svg.scene-svg');
    if (!svgEl) return;
    const canvas = this.store.scene().canvas;
    const base = this.displayName || this.translate.instant('MENU.UNTITLED');
    const ref = this.dialog.open(ExportPngDialogComponent, {
      width: '340px',
      data: {
        scale: 1,
        transparent: !!canvas.transparentBackground,
        defaultFilename: base + '.png',
        canvasWidth: canvas.width,
        canvasHeight: canvas.height,
      },
    });
    ref.afterClosed().subscribe((result: ExportPngResult | undefined) => {
      if (!result) return; // cancelled
      const filename = result.filename.trim() || 'scene.png';
      void this.exportService.exportPng(
        svgEl,
        canvas,
        { scale: result.scale, transparent: result.transparent },
        filename,
      );
    });
  }

  exportSvg(): void {
    const base = this.displayName || this.translate.instant('MENU.UNTITLED');
    this.exportService.exportSvg(this.store.scene(), base + '.svg');
  }

  // Copy PNG always renders at 1× for speed — scaled copies should use
  // Export PNG (downloads) and paste manually.
  clipboardPng(): void {
    const svgEl = document.querySelector<SVGSVGElement>('svg.scene-svg');
    if (!svgEl) return;
    const canvas = this.store.scene().canvas;
    void this.exportService.copyPngToClipboard(svgEl, canvas, { scale: 1, transparent: !!canvas.transparentBackground });
  }

  clipboardJson(): void {
    void this.exportService.copyJsonToClipboard(this.store.scene());
  }

  openAbout(): void {
    this.dialog.open(AboutDialogComponent, { width: '320px', autoFocus: false });
  }

  onThemeChange(value: Theme): void {
    this.settings.setTheme(value);
  }

  onLanguageChange(value: string): void {
    this.settings.setLanguage(value);
  }

  newScene(): void {
    this.store.newScene();
    this.fileIo.sceneFileName.set(null);
  }

  saveScene(): void {
    void this.fileIo.saveScene();
  }

  saveSceneAs(): void {
    void this.fileIo.saveSceneAs();
  }

  openScene(): void {
    void this.fileIo.openScene();
  }

  placeScene(): void {
    void this.fileIo.placeSceneFile();
  }

  importLegacy(): void {
    if (this.fileIo.busy()) return;
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.sav';
    input.style.display = 'none';
    document.body.appendChild(input);
    input.onchange = () => {
      const file = input.files?.[0];
      if (file) void this.fileIo.importLegacySav(file);
      input.remove();
    };
    input.oncancel = () => input.remove();
    input.click();
  }

  // ── undo / redo (MVP-37) ──────────────────────────────────────────────
  undo(): void {
    if (this.store.canUndo()) this.store.undo();
  }

  redo(): void {
    if (this.store.canRedo()) this.store.redo();
  }

  // ── clipboard (in-memory) ──────────────────────────────────────────────
  copySelected(): void {
    const ids = this.store.selection();
    if (ids.size === 0) return;
    const nodes = this.store.scene().nodes.filter(n => ids.has(n.id));
    this.clipboard.set(nodes.map(n => structuredClone(n) as SceneNode));
  }

  cutSelected(): void {
    this.copySelected();
    if (this.store.selection().size > 0) {
      this.store.removeNodes(this.store.selection());
    }
  }

  pasteClipboard(): void {
    const clip = this.clipboard();
    if (clip.length === 0) return;
    const newNodes = clip.map(n => {
      const c = structuredClone(n) as SceneNode;
      c.id = crypto.randomUUID();
      c.transform = { ...c.transform, x: c.transform.x + 16, y: c.transform.y + 16 };
      return c;
    });
    this.store.addNodes(newNodes, 'Paste');
  }

  // ── selection / arrange / flip ──────────────────────────────────────
  deleteSelected(): void {
    if (this.store.selection().size > 0) this.store.removeNodes(this.store.selection());
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

  selectAll(): void {
    this.store.selectAll();
  }

  deselect(): void {
    this.store.clearSelection();
  }
}
