import { Injectable, signal, inject } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';
import { Scene, SceneNode, identityTransform } from './models';
import { newId } from './ids';
import { SceneStore } from './scene-store';
import { SvgCacheService } from './svg-cache.service';
import { CatalogService } from './catalog.service';
import { ToastService } from './toast.service';

export interface LoadProgress {
  loaded: number;
  total: number;
}

export function collectAssetIdsRec(nodes: SceneNode[]): string[] {
  const out: string[] = [];
  const walk = (ns: SceneNode[]) => {
    for (const n of ns) {
      if (n.type === 'svg-object' || n.type === 'multicolor-object') out.push(n.assetId);
      if (n.type === 'group') walk(n.nodes);
    }
  };
  walk(nodes);
  return out;
}

function normalizeNodes(nodes: SceneNode[]): void {
  for (const n of nodes) {
    if (!n.transform) n.transform = identityTransform();
    if (n.type === 'group') normalizeNodes(n.nodes);
  }
}

@Injectable({ providedIn: 'root' })
export class FileIoService {
  private readonly store = inject(SceneStore);
  private readonly svgCache = inject(SvgCacheService);
  private readonly catalogue = inject(CatalogService);
  private readonly translate = inject(TranslateService);
  private readonly notifier = inject(ToastService);

  loadProgress = signal<LoadProgress | null>(null);

  readonly sceneFileName = signal<string | null>(null);

  async openFile(file: File): Promise<boolean> {
    const text = await file.text();
    return this.loadFromText(text, file.name);
  }

  async loadFromText(text: string, sceneName?: string, toastKey?: string): Promise<boolean> {
    try {
      const scene = this.parseSceneText(text);
      await this.prefetchSceneAssets(scene);
      this.store.loadScene(scene, toastKey ?? this.translate.instant('TOAST.LOADED'));
      this.store.dirty.set(false);
      if (sceneName) this.sceneFileName.set(sceneName);
      return true;
    } catch {
      this.notifier.error('ERROR.OPEN_INVALID');
      return false;
    }
  }

  saveScene(filename?: string): void {
    const scene: Scene = { ...this.store.scene(), savedAt: new Date().toISOString() };
    const name = filename ?? this.sceneFileName() ?? 'scene.laops';
    this.downloadBlob(JSON.stringify(scene, null, 2), name, 'application/json');
    this.store.dirty.set(false);
  }

  async importAsGroup(file: File): Promise<boolean> {
    try {
      const text = await file.text();
      const scene = this.parseSceneText(text);
      await this.prefetchSceneAssets(scene);
      const group: SceneNode = {
        id: newId(),
        type: 'group',
        label: file.name.replace(/\.laops$/i, ''),
        sourceName: file.name,
        transform: identityTransform(),
        visible: true,
        locked: false,
        nodes: JSON.parse(JSON.stringify(scene.nodes)) as SceneNode[]
      };
      this.store.addNode(group);
      return true;
    } catch {
      this.notifier.error('ERROR.OPEN_INVALID');
      return false;
    }
  }

  parseSceneText(text: string): Scene {
    const obj = JSON.parse(text) as Partial<Scene>;
    if (!obj || obj.version !== 2 || !Array.isArray(obj.nodes) || !obj.canvas) {
      throw new Error('invalid scene file');
    }
    const scene = obj as Scene;
    normalizeNodes(scene.nodes);
    return scene;
  }

  downloadBlob(content: string, name: string, type: string): void {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  private async prefetchSceneAssets(scene: Scene): Promise<void> {
    const ids = [...new Set(collectAssetIdsRec(scene.nodes))];
    const map = new Map<string, string>();
    let loaded = 0;
    this.loadProgress.set({ loaded: 0, total: ids.length });
    for (const id of ids) {
      if (!this.svgCache.has(id)) {
        const item = this.catalogue.resolve(id);
        if (item) {
          const ok = await this.fetchInto(id, map, item.path);
          if (ok) loaded++;
        }
      } else {
        loaded++;
      }
      this.loadProgress.set({ loaded, total: ids.length });
    }
    this.svgCache.populate(map);
    this.loadProgress.set(null);
  }

  private async fetchInto(id: string, map: Map<string, string>, path: string): Promise<boolean> {
    try {
      const res = await fetch('assets/' + path);
      if (!res.ok) return false;
      map.set(id, await res.text());
      return true;
    } catch {
      return false;
    }
  }
}
