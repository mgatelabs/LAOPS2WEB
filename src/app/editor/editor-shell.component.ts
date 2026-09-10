import { Component, HostBinding, OnInit, inject } from '@angular/core';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MenuBarComponent } from './menu-bar.component';
import { ToolBarComponent } from './tool-bar.component';
import { CanvasComponent } from './canvas.component';
import { RightPanelHostComponent } from './right-panel-host.component';
import { CatalogService } from '../core/catalog.service';
import { SvgCacheService } from '../core/svg-cache.service';
import { SettingsService } from '../core/settings.service';
import { LoadingDialogComponent, LoadingDialogData } from '../shared/loading-dialog.component';

@Component({
  selector: 'app-editor-shell',
  standalone: true,
  imports: [
    MenuBarComponent, ToolBarComponent, CanvasComponent, RightPanelHostComponent,
    MatDialogModule,
  ],
  templateUrl: './editor-shell.component.html',
  styleUrl: './editor-shell.component.scss'
})
export class EditorShellComponent implements OnInit {
  readonly settings = inject(SettingsService);

  constructor(
    private readonly catalog: CatalogService,
    private readonly svgCache: SvgCacheService,
    private readonly dialog: MatDialog,
  ) {}

  @HostBinding('style.--right-panel-width')
  get rightPanelWidth(): string {
    return this.settings.rightPanelOpen() ? '344px' : '0px';
  }

  ngOnInit(): void {
    const allIds = this.catalog.allItems().map(i => i.id);
    if (allIds.length === 0) return;

    const data: LoadingDialogData = { loaded: 0, total: allIds.length };
    const ref = this.dialog.open(LoadingDialogComponent, {
      data,
      disableClose: true,
      panelClass: 'loading-dialog-panel',
    });

    this.svgCache.loadBundle((loaded, total) => {
      data.loaded = loaded;
      data.total = total || allIds.length;
      ref.componentInstance.data = { ...data };
    }).then(() => ref.close());
  }
}

