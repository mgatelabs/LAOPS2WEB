import { Injectable, signal, computed, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

export interface AssetPart {
  id: string;
  label: string;
}

export interface CatalogItem {
  id: string;
  label: string;
  description: string;
  author: string;
  tags: string[];
  multiColor: boolean;
  path: string;
  preview: string;
  parts: AssetPart[];
}

export interface CatalogFolder {
  id: string;
  label: string;
  description: string;
  author: string;
  folders: CatalogFolder[];
  items: CatalogItem[];
}

export interface CatalogSection {
  id: string;
  label: string;
  folders: CatalogFolder[];
}

export interface AssetCatalogue {
  version: number;
  generated?: string;
  sections: CatalogSection[];
}

interface RuntimeAsset {
  id: string;
  label: string;
  svgText: string;
  multiColor: boolean;
  parts: AssetPart[];
}

@Injectable({ providedIn: 'root' })
export class CatalogService {
  private readonly http = inject(HttpClient);

  catalogue = signal<AssetCatalogue>({ version: 1, sections: [] });
  loaded = signal(false);
  loading = signal(false);
  private readonly runtimeAssets = new Map<string, RuntimeAsset>();

  readonly itemCount = computed(() => {
    const countFolders = (folders: CatalogFolder[]): number =>
      folders.reduce((sum, f) => sum + f.items.length + countFolders(f.folders), 0);
    return this.catalogue().sections.reduce((sum, s) => sum + countFolders(s.folders), 0);
  });

  async load(): Promise<void> {
    if (this.loaded() || this.loading()) return;
    this.loading.set(true);
    try {
      const cat = await firstValueFrom(this.http.get<any>('assets/assets.json'));
      if (cat && Array.isArray(cat.sections)) {
        this.catalogue.set(normaliseCatalogue(cat));
      }
    } catch {
      // missing assets.json — catalogue stays empty
    } finally {
      this.loading.set(false);
      this.loaded.set(true);
    }
  }

  registerRuntimeAsset(
    id: string, label: string, svgText: string,
    multiColor: boolean, parts: AssetPart[]
  ): void {
    const cat = this.catalogue();
    const runtimeId = 'runtime';
    const folderId = 'runtime/Uploaded';

    const item: CatalogItem = {
      id, label,
      description: '', author: '', tags: [],
      multiColor,
      path: 'runtime/Uploaded/' + id + '.svg',
      preview: '',
      parts
    };

    const existingSection = cat.sections.find(s => s.id === runtimeId);
    const existingFolder: CatalogFolder = existingSection?.folders.find(f => f.id === folderId)
      ?? { id: folderId, label: 'Uploaded Assets', description: '', author: '', folders: [], items: [] };

    const updatedFolder: CatalogFolder = { ...existingFolder, items: [...existingFolder.items, item] };
    const updatedSection: CatalogSection = existingSection
      ? {
          ...existingSection,
          folders: existingSection.folders.map(f => f.id === folderId ? updatedFolder : f),
        }
      : { id: runtimeId, label: 'Uploaded', folders: [updatedFolder] };

    if (!existingSection?.folders.find(f => f.id === folderId)) {
      (updatedSection.folders as CatalogFolder[]).push(updatedFolder);
    }

    this.catalogue.set({
      ...cat,
      sections: existingSection
        ? cat.sections.map(s => s.id === runtimeId ? updatedSection : s)
        : [...cat.sections, updatedSection],
    });
    this.runtimeAssets.set(id, { id, label, svgText, multiColor, parts });
  }

  has(assetId: string): boolean {
    return this.findAll().some(i => i.id === assetId);
  }

  resolve(assetId: string): CatalogItem | undefined {
    return this.findAll().find(i => i.id === assetId);
  }

  svgUrl(item: CatalogItem): string {
    return 'assets/' + item.path;
  }

  previewUrl(item: CatalogItem): string {
    return item.preview ? 'assets/' + item.preview : '';
  }

  runtimeSvgText(assetId: string): string | null {
    return this.runtimeAssets.get(assetId)?.svgText ?? null;
  }

  readonly allItems = computed(() => this.findAll());

  private findAll(): CatalogItem[] {
    const out: CatalogItem[] = [];
    const walkFolders = (folders: CatalogFolder[]) => {
      for (const f of folders) {
        out.push(...f.items);
        walkFolders(f.folders);
      }
    };
    for (const section of this.catalogue().sections) {
      walkFolders(section.folders);
    }
    return out;
  }
}

function normaliseItem(i: any): CatalogItem {
  return {
    id:          i.id          ?? '',
    label:       i.label       ?? i.id ?? '',
    description: i.description ?? '',
    author:      i.author      ?? '',
    tags:        i.tags        ?? [],
    multiColor:  !!i.multiColor,
    path:        i.path        ?? '',
    preview:     i.preview     ?? '',
    parts:       (i.parts ?? []).map((p: any) => ({
      id:    p.id    ?? '',
      label: p.label ?? p.id ?? '',
    })),
  };
}

function normaliseFolder(f: any): CatalogFolder {
  return {
    id:          f.id          ?? '',
    label:       f.label       ?? f.id ?? '',
    description: f.description ?? '',
    author:      f.author      ?? '',
    folders:     (f.folders ?? []).map(normaliseFolder),
    items:       (f.items   ?? []).map(normaliseItem),
  };
}

function normaliseCatalogue(cat: any): AssetCatalogue {
  return {
    version:   cat.version   ?? 1,
    generated: cat.generated,
    sections:  (cat.sections ?? []).map((s: any) => ({
      id:      s.id      ?? s.key ?? '',
      label:   s.label   ?? s.id  ?? '',
      folders: (s.folders ?? []).map(normaliseFolder),
    })),
  };
}
