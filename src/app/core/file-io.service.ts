import { Injectable, signal, inject, NgZone } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';
import { Scene, SceneNode, GroupNode, IDENTITY_TRANSFORM, MultiColorObjectNode, MultiColorPart } from './models';
import { newId } from './ids';
import { SceneStore } from './scene-store';
import { SvgCacheService } from './svg-cache.service';
import { CatalogService, CatalogFolder } from './catalog.service';
import { ToastService } from './toast.service';
import { parseLegacySav } from './legacy-sav-parser';

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

/**
 * Extracts the multicolor part `<g id>` names from an SVG, in document
 * order — mirroring detect_multicolor() in scripts/post_catalog.py so the
 * order matches both the catalog parts list and the legacy .sav part slots.
 */
export function extractSvgPartIds(svgText: string): string[] {
  try {
    const doc = new DOMParser().parseFromString(svgText, 'image/svg+xml');
    const root = doc.documentElement;
    if (root.nodeName.toLowerCase() !== 'svg') return [];
    const children = Array.from(root.children);
    const parent = children.length === 1 && children[0].nodeName.toLowerCase() === 'g'
      ? children[0]
      : root;
    const hasShape = (el: Element): boolean =>
      Array.from(el.children).some(c =>
        ['path', 'rect', 'circle'].includes(c.nodeName.toLowerCase()));
    return Array.from(parent.children)
      .filter(c => c.nodeName.toLowerCase() === 'g' && c.hasAttribute('id') && hasShape(c))
      .map(c => c.getAttribute('id') as string);
  } catch {
    return [];
  }
}

function normalizeNodes(nodes: SceneNode[]): void {
  for (const n of nodes) {
    if (!n.transform) n.transform = { ...IDENTITY_TRANSFORM };
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
  private readonly zone = inject(NgZone);

  loadProgress = signal<LoadProgress | null>(null);

  /** True while a scene/file import or single-scene load is in flight. */
  readonly busy = signal(false);

  readonly sceneFileName = signal<string | null>(null);

  // Retained after a native open/save-as so subsequent saves go to the same file
  private fileHandle: FileSystemFileHandle | null = null;

  private readonly pickerOpts: any = {
    suggestedName: 'scene.laops',
    types: [{ description: 'LAOPS Scene', accept: { 'application/json': ['.laops'] } }],
  };

  private get fsaSupported(): boolean {
    return typeof (window as any).showSaveFilePicker === 'function';
  }

  // ── open ──────────────────────────────────────────────────────────────────

  async openScene(): Promise<void> {
    if (this.fsaSupported) {
      try {
        const [handle] = await (window as any).showOpenFilePicker({
          types: [{ description: 'LAOPS Scene', accept: { 'application/json': ['.laops'] } }],
          multiple: false,
        });
        const file: File = await handle.getFile();
        const ok = await this.loadFromText(await file.text(), file.name);
        if (ok) this.fileHandle = handle;
      } catch (err: any) {
        if (err?.name !== 'AbortError') this.notifier.error('ERROR.OPEN_INVALID');
      }
    } else {
      // Fallback: hidden <input>
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.laops';
      input.onchange = () => {
        const file = input.files?.[0];
        if (file) void this.openFile(file);
      };
      input.click();
    }
  }

  async openFile(file: File): Promise<boolean> {
    const text = await file.text();
    return this.loadFromText(text, file.name);
  }

  async loadFromText(text: string, sceneName?: string, toastKey?: string): Promise<boolean> {
    this.busy.set(true);
    try {
      const scene = this.parseSceneText(text);
      await this.prefetchSceneAssets(scene);
      this.zone.run(() => {
        this.store.loadScene(scene, toastKey ?? this.translate.instant('TOAST.LOADED'));
        this.store.dirty.set(false);
        if (sceneName) this.sceneFileName.set(sceneName);
      });
      return true;
    } catch {
      this.notifier.error('ERROR.OPEN_INVALID');
      return false;
    } finally {
      this.busy.set(false);
    }
  }

  // ── save ──────────────────────────────────────────────────────────────────

  async saveScene(): Promise<void> {
    if (this.fsaSupported) {
      // Re-use existing handle if we have one, otherwise prompt
      const handle = this.fileHandle ?? await this.pickSaveHandle();
      if (!handle) return;
      await this.writeToHandle(handle);
      this.fileHandle = handle;
    } else {
      this.downloadFallback();
    }
  }

  async saveSceneAs(): Promise<void> {
    if (this.fsaSupported) {
      const handle = await this.pickSaveHandle();
      if (!handle) return;
      await this.writeToHandle(handle);
      this.fileHandle = handle;
      this.sceneFileName.set(handle.name);
    } else {
      this.downloadFallback();
    }
  }

  private async pickSaveHandle(): Promise<FileSystemFileHandle | null> {
    const suggested = this.sceneFileName() ?? 'scene.laops';
    try {
      return await (window as any).showSaveFilePicker({
        ...this.pickerOpts,
        suggestedName: suggested,
      });
    } catch (err: any) {
      if (err?.name !== 'AbortError') this.notifier.error('ERROR.OPEN_INVALID');
      return null;
    }
  }

  private async writeToHandle(handle: FileSystemFileHandle): Promise<void> {
    const scene: Scene = { ...this.store.scene(), savedAt: new Date().toISOString() };
    const json = JSON.stringify(scene, null, 2);
    const writable = await handle.createWritable();
    await writable.write(json);
    await writable.close();
    this.store.dirty.set(false);
    this.sceneFileName.set(handle.name);
  }

  private downloadFallback(filename?: string): void {
    const scene: Scene = { ...this.store.scene(), savedAt: new Date().toISOString() };
    const name = filename ?? this.sceneFileName() ?? 'scene.laops';
    this.downloadBlob(JSON.stringify(scene, null, 2), name, 'application/json');
    this.store.dirty.set(false);
    this.notifier.info('TOAST.SAVED_DOWNLOAD');
  }

  async importAsGroup(file: File): Promise<boolean> {
    this.busy.set(true);
    try {
      const text = await file.text();
      const scene = this.parseSceneText(text);
      await this.prefetchSceneAssets(scene);
      const group: SceneNode = {
        id: newId(),
        type: 'group',
        label: file.name.replace(/\.laops$/i, ''),
        sourceName: file.name,
        transform: { ...IDENTITY_TRANSFORM },
        visible: true,
        locked: false,
        nodes: JSON.parse(JSON.stringify(scene.nodes)) as SceneNode[]
      };
      this.zone.run(() => this.store.addNode(group));
      return true;
    } catch {
      this.notifier.error('ERROR.OPEN_INVALID');
      return false;
    } finally {
      this.busy.set(false);
    }
  }

  async placeSceneFile(): Promise<void> {
    let file: File | null = null;
    if (this.fsaSupported) {
      try {
        const [handle] = await (window as any).showOpenFilePicker({
          types: [{ description: 'LAOPS Scene', accept: { 'application/json': ['.laops'] } }],
          multiple: false,
        });
        file = await handle.getFile();
      } catch {
        return; // cancelled
      }
    } else {
      file = await this.pickInputFile();
    }
    if (!file) return;

    let scene: Scene;
    try {
      scene = this.parseSceneText(await file.text());
    } catch {
      this.notifier.error('ERROR.OPEN_INVALID');
      return;
    }
    if (scene.nodes.length === 0) return;

    await this.prefetchSceneAssets(scene);
    const group: GroupNode = {
      id: newId(),
      type: 'group',
      label: file.name.replace(/\.laops$/i, ''),
      sourceName: file.name,
      transform: { ...IDENTITY_TRANSFORM },
      visible: true,
      locked: false,
      nodes: this.remapIds(scene.nodes),
    };
    this.zone.run(() => this.store.addNodes([group], 'Place'));
  }

  async importAsGroupFromText(text: string, name: string): Promise<boolean> {
    this.busy.set(true);
    try {
      const scene = this.parseSceneText(text);
      await this.prefetchSceneAssets(scene);
      const canvas = this.store.scene().canvas;
      const group: GroupNode = {
        id: newId(),
        type: 'group',
        label: name,
        sourceName: name + '.laops',
        transform: { ...IDENTITY_TRANSFORM, x: Math.round(canvas.width / 2), y: Math.round(canvas.height / 2) },
        visible: true,
        locked: false,
        nodes: this.remapIds(scene.nodes),
      };
      this.zone.run(() => this.store.addNode(group));
      return true;
    } catch {
      this.notifier.error('ERROR.OPEN_INVALID');
      return false;
    } finally {
      this.busy.set(false);
    }
  }

  private pickInputFile(): Promise<File | null> {
    return new Promise(resolve => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.laops';
      input.onchange = () => resolve(input.files?.[0] ?? null);
      input.oncancel = () => resolve(null);
      input.click();
    });
  }

  private remapIds(nodes: SceneNode[]): SceneNode[] {
    return nodes.map(n =>
      n.type === 'group'
        ? { ...n, id: newId(), nodes: this.remapIds(n.nodes) }
        : { ...n, id: newId() }
    );
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

  // ── legacy .sav import (MVP-65) ──────────────────────────────────────────

  async importLegacySav(file: File): Promise<void> {
    this.busy.set(true);
    try {
      const text = await file.text();
      const result = parseLegacySav(text);
      await this.prefetchLegacyAssets(result.nodes, result.warnings);
      const scene: Scene = {
        version: 2,
        savedAt: new Date().toISOString(),
        canvas: {
          width: result.header.width,
          height: result.header.height,
          backgroundColor: result.header.backgroundColor,
          borderColor: result.header.borderColor,
        },
        nodes: result.nodes,
      };
      this.zone.run(() => {
        this.store.loadScene(scene, this.translate.instant('TOAST.LOADED_LEGACY', { n: result.nodes.length }));
        this.sceneFileName.set(null);
      });
      // MVP-81: same reinject as .laops open (see loadFromText).
      setTimeout(() => this.store.triggerSvgReinject(), 0);
      // MVP-81: re-run the SVG reinject on the next macrotask so any
      // data-svg-rendered markers from a stale DOM don't block the new
      // scene's assets (cache was populated mid-load, before this ran).
      setTimeout(() => this.store.triggerSvgReinject(), 0);
      if (result.warnings.length) {
        console.warn('[legacy import]', result.warnings);
        this.notifier.info('TOAST.IMPORT_WARNINGS', { n: result.warnings.length });
      }
    } catch (err) {
      console.error('[legacy import] failed:', err);
      this.notifier.error('ERROR.OPEN_INVALID');
    } finally {
      this.busy.set(false);
    }
  }

  /**
   * Legacy `.sav` files reference assets by relative path (e.g. `objects\Weapons\MedPack.svg`).
   * The new catalog uses opaque IDs (e.g. `ME179`). This method:
   *   1. Builds a stem→catalogId map from the loaded catalog (label match, case-insensitive).
   *   2. Rewrites each node's assetId in-place to the catalog ID when a match is found.
   *   3. For unmatched IDs, fetches the SVG and registers a runtime catalog entry so
   *      the canvas still renders it (with the path as the ID).
   *
   * Lookup key: `sectionId/folderTrail/label` (all lowercase, forward-slash separated).
   * Legacy path `objects\Weapons\MedPack.svg` → key `objects/weapons/medpack`.
   * Including the section resolves the 6 label collisions that exist across sections.
   */
  private async prefetchLegacyAssets(nodes: SceneNode[], warnings: string[]): Promise<void> {
    // Build sectionId/folderTrail/label → catalogId lookup
    const pathToId = new Map<string, string>();
    const walkCatalog = (folders: CatalogFolder[], trail: string): void => {
      for (const f of folders) {
        const next = trail + '/' + f.label.toLowerCase();
        for (const item of f.items) {
          pathToId.set(next + '/' + item.label.toLowerCase(), item.id);
        }
        walkCatalog(f.folders, next);
      }
    };
    for (const section of this.catalogue.catalogue().sections) {
      walkCatalog(section.folders, section.id.toLowerCase());
    }

    // Rewrite node assetIds in-place using full path key, falling back to label-only
    const rewriteIds = (ns: SceneNode[]): void => {
      for (const n of ns) {
        if (n.type === 'svg-object' || n.type === 'multicolor-object') {
          const parts = n.assetId.replace(/\\/g, '/').split('/');
          const stem = (parts[parts.length - 1] ?? '').replace(/\.svg$/i, '').toLowerCase();
          // Full path key: all segments lowercased, stem replacing the filename
          const key = parts.slice(0, -1).map(s => s.toLowerCase()).join('/') + '/' + stem;
          const catalogId = pathToId.get(key) ?? pathToId.get(stem);
          if (catalogId) (n as any).assetId = catalogId;
        }
        if (n.type === 'group') rewriteIds(n.nodes);
      }
    };
    rewriteIds(nodes);

    // For any remaining path-based IDs (no catalog match), fetch and register runtime
    const multi = new Set<string>();
    const multiNodes: MultiColorObjectNode[] = [];
    const walkMulti = (ns: SceneNode[]): void => {
      for (const n of ns) {
        if (n.type === 'multicolor-object') {
          multi.add(n.assetId);
          multiNodes.push(n as MultiColorObjectNode);
        }
        if (n.type === 'group') walkMulti(n.nodes);
      }
    };
    walkMulti(nodes);

    const map = new Map<string, string>();
    const partIdsByAsset = new Map<string, string[]>();
    let missing = 0;
    for (const id of [...new Set(collectAssetIdsRec(nodes))]) {
      if (this.svgCache.has(id) || this.catalogue.has(id)) continue;
      try {
        const res = await fetch('assets/' + id.replace(/\\/g, '/'));
        if (!res.ok) { missing++; continue; }
        const svgText = await res.text();
        const label = (id.split(/[\\/]/).pop() ?? id).replace(/\.svg$/i, '');
        const partIds = extractSvgPartIds(svgText);
        partIdsByAsset.set(id, partIds);
        this.catalogue.registerRuntimeAsset(
          id, label, svgText, multi.has(id),
          partIds.map(pid => ({ id: pid, label: pid })),
        );
        map.set(id, svgText);
      } catch {
        missing++;
      }
    }
    // Remap the parser's synthetic part-N IDs onto the real part names in a
    // single pass: runtime assets from the SVG document, catalog assets from
    // the catalog parts list (both in document order, matching the parser).
    for (const n of multiNodes) {
      const named = partIdsByAsset.get(n.assetId)
        ?? (this.catalogue.resolve(n.assetId)?.parts ?? []).map(p => p.id);
      this.remapMultiParts(n, named, warnings);
    }
    if (map.size) this.svgCache.populate(map);
    if (missing > 0) this.notifier.info('TOAST.LEGACY_MISSING_ASSETS', { n: missing });
  }

  /**
   * The legacy parser assigns positional IDs (`part-1`, `part-2`, …) that do
   * not match the SVG `<g id>` names the canvas renderer queries by ID.
   * Remap the overrides onto the ordered named part IDs; when the counts
   * diverge the import data is unreliable and the overrides are dropped.
   */
  private remapMultiParts(
    node: MultiColorObjectNode,
    namedIds: string[],
    warnings: string[],
  ): void {
    const parts = node.parts;
    if (!parts.length) return;
    if (namedIds.length === parts.length) {
      node.parts = parts.map((p, i) => ({ ...p, id: namedIds[i] }));
    } else {
      node.parts = [];
      warnings.push(`Part colors for "${node.label}" not imported ` +
        `(SVG has ${namedIds.length} part(s), file has ${parts.length})`);
    }
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
