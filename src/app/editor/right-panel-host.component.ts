import { Component, signal, effect, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TranslateModule } from '@ngx-translate/core';
import { PropertiesPanelComponent } from '../panels/properties-panel.component';
import { TransformPanelComponent } from '../panels/transform-panel.component';
import { LayersPanelComponent } from '../panels/layers-panel.component';
import { AssetPanelComponent } from '../panels/asset-panel.component';
import { ScenePanelComponent } from '../panels/scene-panel.component';
import { SceneStore } from '../core/scene-store';

type PanelId = 'properties' | 'transform' | 'layers' | 'assets' | 'scenes';

const STORAGE_KEY = 'laops.activePanel';
const DEFAULT_PANEL: PanelId = 'assets';

function persistedPanel(): PanelId {
  const saved = localStorage.getItem(STORAGE_KEY);
  const ids: PanelId[] = ['properties', 'transform', 'layers', 'assets', 'scenes'];
  return saved && (ids as string[]).includes(saved) ? saved as PanelId : DEFAULT_PANEL;
}

@Component({
  selector: 'app-right-panel-host',
  standalone: true,
  imports: [
    PropertiesPanelComponent,
    TransformPanelComponent,
    LayersPanelComponent,
    AssetPanelComponent,
    ScenePanelComponent,
    MatButtonModule,
    MatIconModule,
    MatTooltipModule,
    TranslateModule,
  ],
  templateUrl: './right-panel-host.component.html',
  styleUrl: './right-panel-host.component.scss',
})
export class RightPanelHostComponent {
  readonly panels: Array<{ id: PanelId; labelKey: string }> = [
    { id: 'properties', labelKey: 'PANEL.PROPERTIES' },
    { id: 'transform',  labelKey: 'PANEL.TRANSFORM' },
    { id: 'layers',     labelKey: 'PANEL.LAYERS' },
    { id: 'assets',     labelKey: 'PANEL.ASSETS' },
    { id: 'scenes',     labelKey: 'PANEL.SCENES' },
  ];

  readonly activePanel = signal<PanelId | null>(persistedPanel());

  private readonly store = inject(SceneStore);
  private lastSelectionSize = 0;

  constructor() {
    // Remember the last open panel across reloads.
    effect(() => {
      const p = this.activePanel();
      if (p) localStorage.setItem(STORAGE_KEY, p);
    });

    // Automatically switch to Properties when the user makes a selection.
    // Triggered only on a deselect → select transition so a manual switch to
    // another panel (Assets, Layers…) is not immediately overridden while a
    // node remains selected.
    effect(() => {
      const size = this.store.selection().size;
      if (size > 0 && this.lastSelectionSize === 0) {
        this.activePanel.set('properties');
      }
      this.lastSelectionSize = size;
    }, { allowSignalWrites: true });
  }

  toggle(id: PanelId): void {
    this.activePanel.update(current => (current === id ? null : id));
  }

  onSelectAll(): void {
    this.store.selectAll();
  }

  isOpen(id: PanelId): boolean {
    return this.activePanel() === id;
  }
}
