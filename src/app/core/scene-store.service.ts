import { Injectable, computed, signal } from '@angular/core';
import {
  Scene, SceneNode, CanvasSettings, Transform,
  defaultScene
} from './models';

@Injectable({ providedIn: 'root' })
export class SceneStoreService {

  // ── Private state ────────────────────────────────────────────────────────

  private _scene   = signal<Scene>(defaultScene());
  private _selIds  = signal<Set<string>>(new Set());
  private _dirty   = signal(false);

  // ── Public read signals ──────────────────────────────────────────────────

  readonly scene       = this._scene.asReadonly();
  readonly canvas      = computed(() => this._scene().canvas);
  readonly nodes       = computed(() => this._scene().nodes);
  readonly selectedIds = this._selIds.asReadonly();
  readonly isDirty     = this._dirty.asReadonly();

  // Derived selection helpers
  readonly selectedNodes = computed(() => {
    const ids = this._selIds();
    return this._scene().nodes.filter(n => ids.has(n.id));
  });
  readonly isSingleSelection = computed(() => this._selIds().size === 1);
  readonly isMultiSelection  = computed(() => this._selIds().size > 1);
  readonly hasSelection      = computed(() => this._selIds().size > 0);
  readonly selectedNode      = computed((): SceneNode | null => {
    if (!this.isSingleSelection()) return null;
    const [id] = this._selIds();
    return this._scene().nodes.find(n => n.id === id) ?? null;
  });

  // ── Scene mutations ──────────────────────────────────────────────────────

  loadScene(scene: Scene): void {
    this._scene.set(scene);
    this._selIds.set(new Set());
    this._dirty.set(false);
  }

  newScene(): void {
    this.loadScene(defaultScene());
  }

  setCanvas(canvas: CanvasSettings): void {
    this._scene.update(s => ({ ...s, canvas }));
    this._dirty.set(true);
  }

  addNode(node: SceneNode): void {
    this._scene.update(s => ({ ...s, nodes: [...s.nodes, node] }));
    this._dirty.set(true);
  }

  removeNode(id: string): void {
    this._scene.update(s => ({ ...s, nodes: s.nodes.filter(n => n.id !== id) }));
    this._selIds.update(ids => { const next = new Set(ids); next.delete(id); return next; });
    this._dirty.set(true);
  }

  removeNodes(ids: Set<string>): void {
    this._scene.update(s => ({ ...s, nodes: s.nodes.filter(n => !ids.has(n.id)) }));
    this._selIds.set(new Set());
    this._dirty.set(true);
  }

  updateNode(updated: SceneNode): void {
    this._scene.update(s => ({
      ...s,
      nodes: s.nodes.map(n => n.id === updated.id ? updated : n),
    }));
    this._dirty.set(true);
  }

  updateNodes(updates: SceneNode[]): void {
    const map = new Map(updates.map(n => [n.id, n]));
    this._scene.update(s => ({
      ...s,
      nodes: s.nodes.map(n => map.has(n.id) ? map.get(n.id)! : n),
    }));
    this._dirty.set(true);
  }

  updateTransform(id: string, transform: Transform): void {
    this._scene.update(s => ({
      ...s,
      nodes: s.nodes.map(n => n.id === id ? { ...n, transform } : n),
    }));
    this._dirty.set(true);
  }

  // ── Selection ────────────────────────────────────────────────────────────

  setSelection(ids: string[]): void {
    this._selIds.set(new Set(ids));
  }

  addToSelection(id: string): void {
    this._selIds.update(s => new Set([...s, id]));
  }

  removeFromSelection(id: string): void {
    this._selIds.update(s => { const n = new Set(s); n.delete(id); return n; });
  }

  toggleSelection(id: string): void {
    this._selIds.update(s => {
      const next = new Set(s);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  clearSelection(): void {
    this._selIds.set(new Set());
  }

  // ── Layer order ──────────────────────────────────────────────────────────

  moveUp(id: string): void {
    this._scene.update(s => {
      const nodes = [...s.nodes];
      const i = nodes.findIndex(n => n.id === id);
      if (i < nodes.length - 1) [nodes[i], nodes[i + 1]] = [nodes[i + 1], nodes[i]];
      return { ...s, nodes };
    });
    this._dirty.set(true);
  }

  moveDown(id: string): void {
    this._scene.update(s => {
      const nodes = [...s.nodes];
      const i = nodes.findIndex(n => n.id === id);
      if (i > 0) [nodes[i], nodes[i - 1]] = [nodes[i - 1], nodes[i]];
      return { ...s, nodes };
    });
    this._dirty.set(true);
  }

  moveToFront(id: string): void {
    this._scene.update(s => {
      const nodes = s.nodes.filter(n => n.id !== id);
      const node = s.nodes.find(n => n.id === id)!;
      return { ...s, nodes: [...nodes, node] };
    });
    this._dirty.set(true);
  }

  moveToBack(id: string): void {
    this._scene.update(s => {
      const nodes = s.nodes.filter(n => n.id !== id);
      const node = s.nodes.find(n => n.id === id)!;
      return { ...s, nodes: [node, ...nodes] };
    });
    this._dirty.set(true);
  }

  // ── Visibility / lock ────────────────────────────────────────────────────

  setVisible(id: string, visible: boolean): void {
    this._scene.update(s => ({
      ...s,
      nodes: s.nodes.map(n => n.id === id ? { ...n, visible } : n),
    }));
  }

  setLocked(id: string, locked: boolean): void {
    this._scene.update(s => ({
      ...s,
      nodes: s.nodes.map(n => n.id === id ? { ...n, locked } : n),
    }));
  }

  markClean(): void {
    this._dirty.set(false);
  }
}
