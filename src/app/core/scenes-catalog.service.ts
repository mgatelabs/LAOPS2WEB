import { Injectable, signal, inject } from '@angular/core';
import { FileIoService } from './file-io.service';

export interface SceneItem {
  id: string;
  label: string;
  description?: string;
  author?: string;
  tags?: string[];
  path: string;
  preview: string;
}

export interface SceneFolder {
  id: string;
  label?: string;
  description?: string;
  author?: string;
  items: SceneItem[];
  folders?: SceneFolder[];
}

export interface ScenesCatalog {
  version: number;
  generated?: string;
  folders: SceneFolder[];
}

/**
 * Loads and serves the built-in Scene Library (scenes.json).
 *
 * `path` and `preview` in the catalogue are relative to `src/assets/` — the
 * service prepends the `assets/` base to build fetchable URLs.
 */
@Injectable({ providedIn: 'root' })
export class ScenesCatalogService {
  private readonly fileIo = inject(FileIoService);

  catalog = signal<ScenesCatalog | null>(null);
  loaded = signal(false);
  loading = signal(false);

  async load(): Promise<void> {
    if (this.loaded() || this.loading()) return;
    this.loading.set(true);
    try {
      const res = await fetch('/assets/scenes.json');
      if (!res.ok) throw new Error('scenes.json not found');
      const data = (await res.json()) as ScenesCatalog;
      this.catalog.set(data);
    } catch {
      this.catalog.set({ version: 1, folders: [] });
    } finally {
      this.loaded.set(true);
      this.loading.set(false);
    }
  }

  /** Build a fetchable URL from the asset-relative path. */
  urlFor(relPath: string): string {
    return '/assets/' + relPath.replace(/^\/+/, '');
  }

  /** Flatten all items across nested folders, preserving order. */
  items(): SceneItem[] {
    return this.flatten(this.catalog()?.folders ?? []);
  }

  private flatten(folders: SceneFolder[], out: SceneItem[] = []): SceneItem[] {
    for (const f of folders) {
      out.push(...f.items);
      if (f.folders) this.flatten(f.folders, out);
    }
    return out;
  }

  /**
   * Fetch and load a built-in scene, replacing the current scene.
   * Returns true when the scene was accepted.
   */
  async loadScene(item: SceneItem): Promise<boolean> {
    const res = await fetch(this.urlFor(item.path));
    if (!res.ok) return false;
    const text = await res.text();
    return this.fileIo.loadFromText(text, item.id + '.laops');
  }
}
