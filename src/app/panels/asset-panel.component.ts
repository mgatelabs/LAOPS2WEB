import { Component, inject, OnInit } from '@angular/core';
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
  ],
  templateUrl: './asset-panel.component.html',
  styleUrl: './asset-panel.component.scss',
})
export class AssetPanelComponent implements OnInit {
  readonly catalog = inject(CatalogService);
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

  get filteredItems(): CatalogItem[] {
    const q = this.searchQuery.trim().toLowerCase();
    if (!q) return [];
    return this.catalog.allItems().filter(i =>
      i.label.toLowerCase().includes(q) ||
      i.tags.some(t => t.toLowerCase().includes(q))
    );
  }
}
