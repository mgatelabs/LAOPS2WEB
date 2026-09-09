import { Injectable, signal, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { CatalogService } from './catalog.service';

@Injectable({ providedIn: 'root' })
export class SvgCacheService {
  private readonly http = inject(HttpClient);
  private readonly catalogue = inject(CatalogService);

  private readonly cache = new Map<string, DocumentFragment>();
  private readonly inFlight = new Map<string, Promise<boolean>>();

  readonly loadedCount = signal(0);

  has(assetId: string): boolean {
    return this.cache.has(assetId) || this.catalogue.runtimeSvgText(assetId) !== null;
  }

  getSvgClone(assetId: string): DocumentFragment | null {
    const cached = this.cache.get(assetId);
    if (cached) return cached.cloneNode(true) as DocumentFragment;
    const runtime = this.catalogue.runtimeSvgText(assetId);
    if (runtime !== null) {
      const frag = this.parseText(runtime);
      if (frag) {
        this.cache.set(assetId, frag);
        return frag.cloneNode(true) as DocumentFragment;
      }
    }
    return null;
  }

  populate(map: Map<string, string>, progress?: (loaded: number, total: number) => void): void {
    const entries = [...map.entries()];
    let i = 0;
    for (const [assetId, svgText] of entries) {
      this.cacheRaw(assetId, svgText);
      i++;
      progress?.(i, entries.length);
    }
  }

  async prefetch(assetIds: string[], progress?: (loaded: number, total: number) => void): Promise<void> {
    const todo = assetIds.filter(id => !this.has(id));
    let i = 0;
    for (const id of todo) {
      await this.fetchOne(id);
      i++;
      progress?.(i, todo.length);
    }
  }

  async fetchOne(assetId: string): Promise<boolean> {
    if (this.has(assetId)) return true;
    const inflight = this.inFlight.get(assetId);
    if (inflight) return inflight;
    const promise = (async (): Promise<boolean> => {
      const item = this.catalogue.resolve(assetId);
      if (item) {
        try {
          const text = await firstValueFrom(this.http.get(this.catalogue.svgUrl(item), { responseType: 'text' }));
          this.cacheRaw(assetId, text);
          return true;
        } catch {
          return false;
        }
      }
      return false;
    })();
    this.inFlight.set(assetId, promise);
    try {
      return await promise;
    } finally {
      this.inFlight.delete(assetId);
    }
  }

  private cacheRaw(assetId: string, svgText: string): void {
    const frag = this.parseText(svgText);
    if (!frag) return;
    this.cache.set(assetId, frag);
    this.loadedCount.update(n => n + 1);
  }

  private parseText(svgText: string): DocumentFragment | null {
    const doc = new DOMParser().parseFromString(svgText, 'image/svg+xml');
    if (doc.querySelector('parsererror') || !doc.documentElement || doc.documentElement.nodeName !== 'svg') {
      return null;
    }
    const frag = document.createDocumentFragment();
    while (doc.documentElement.firstChild) {
      frag.appendChild(doc.documentElement.firstChild);
    }
    return frag;
  }
}
