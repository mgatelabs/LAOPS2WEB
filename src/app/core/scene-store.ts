import { Injectable, signal, computed, inject, DestroyRef } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';
import {
  Scene, SceneNode, CanvasSettings, Transform, cloneNode, cloneTransform,
  defaultScene, defaultCanvas, identityTransform
} from './models';
import { composeTransforms } from './transform-math';

const MAX_UNDO = 100;

@Injectable({ providedIn: 'root' })
export class SceneStore {
  private readonly destroyRef = inject(DestroyRef);
  private readonly translate = inject(TranslateService);

  scene = signal<Scene>(defaultScene());
  selection = signal<ReadonlySet<string>>(new Set());
  dirty = signal(false);

  private readonly undoStack: Scene[] = [];
  private readonly redoStack: Scene[] = [];

  readonly canUndo = computed(() => this.undoStack.length > 0);
  readonly canRedo = computed(() => this.redoStack.length > 0);

  readonly selectedNodes = computed<SceneNode[]>(() => this.scene().nodes.filter(n => this.selection().has(n.id)));

  readonly zoom = signal(1);

  undoLabel = signal<string | null>(null);
  redoLabel = signal<string | null>(null);

  constructor() {
    this.destroyRef.onDestroy(() => {
      this.undoStack.length = 0;
      this.redoStack.length = 0;
    });
  }

  // ---------- core ----------

  commit(next: Scene, label?: string): void {
    this.undoStack.push(this.scene());
    if (this.undoStack.length > MAX_UNDO) this.undoStack.shift();
    this.undoLabel.set(label ?? null);
    this.redoStack.length = 0;
    this.redoLabel.set(null);
    pruneSelection(this, next);
    this.scene.update(() => next);
    this.dirty.set(true);
  }

  updateCanvas(updater: Partial<CanvasSettings>): void {
    const cur = this.scene();
    this.commit({ ...cur, canvas: { ...cur.canvas, ...updater } }, this.t('MENU.VIEW_CANVAS_SETTINGS'));
  }

  // ---------- selection ----------

  setSelected(ids: ReadonlySet<string>): void {
    this.selection.set(ids);
  }

  toggleSelected(id: string): void {
    const next = new Set(this.selection());
    if (next.has(id)) next.delete(id);
    else next.add(id);
    this.selection.set(next);
  }

  clearSelection(): void {
    this.selection.set(new Set());
  }

  selectAll(): void {
    this.selection.set(new Set(this.scene().nodes.map(n => n.id)));
  }

  // ---------- nodes ----------

  addNode(node: SceneNode): void {
    const cur = this.scene();
    this.commit({ ...cur, nodes: [...cur.nodes, node] });
    this.selection.set(new Set([node.id]));
  }

  updateNode(id: string, updater: (node: SceneNode) => SceneNode): void {
    const cur = this.scene();
    const mapNode = (n: SceneNode): SceneNode => {
      if (n.id === id) return updater(structuredClone(n));
      if (n.type === 'group') {
        const children = n.nodes.map(mapNode);
        if (children.some((c, i) => c !== n.nodes[i])) {
          return { ...n, nodes: children };
        }
      }
      return n;
    };
    const nodes = cur.nodes.map(mapNode);
    this.commit({ ...cur, nodes });
  }

  removeNodes(ids: ReadonlySet<string>): void {
    const cur = this.scene();
    this.commit({ ...cur, nodes: cur.nodes.filter(n => !ids.has(n.id)) });
    this.clearSelection();
  }

  moveTo(index: number, nodes: SceneNode[]): void {
    const cur = this.scene();
    const remaining = cur.nodes.filter(n => !nodes.some(m => m.id === n.id));
    const clamped = Math.max(0, Math.min(remaining.length, index));
    const result = [...remaining.slice(0, clamped), ...nodes, ...remaining.slice(clamped)];
    this.commit({ ...cur, nodes: result });
  }

  toBack(ids: ReadonlySet<string>): void {
    const cur = this.scene();
    const moving = cur.nodes.filter(n => ids.has(n.id));
    const rest = cur.nodes.filter(n => !ids.has(n.id));
    this.commit({ ...cur, nodes: [...moving, ...rest] });
  }

  toFront(ids: ReadonlySet<string>): void {
    const cur = this.scene();
    const moving = cur.nodes.filter(n => ids.has(n.id));
    const rest = cur.nodes.filter(n => !ids.has(n.id));
    this.commit({ ...cur, nodes: [...rest, ...moving] });
  }

  moveUp(ids: ReadonlySet<string>): void {
    const cur = this.scene();
    const moving = ids;
    let nodes = [...cur.nodes];
    for (const id of [...nodes.map(n => n.id)].reverse()) {
      if (!moving.has(id)) continue;
      const i = nodes.findIndex(n => n.id === id);
      if (i < nodes.length - 1) {
        [nodes[i], nodes[i + 1]] = [nodes[i + 1], nodes[i]];
      }
    }
    this.commit({ ...cur, nodes });
  }

  moveDown(ids: ReadonlySet<string>): void {
    const cur = this.scene();
    let nodes = [...cur.nodes];
    for (const id of cur.nodes.map(n => n.id)) {
      if (!ids.has(id)) continue;
      const i = nodes.findIndex(n => n.id === id);
      if (i > 0) {
        [nodes[i], nodes[i - 1]] = [nodes[i - 1], nodes[i]];
      }
    }
    this.commit({ ...cur, nodes });
  }

  // transforms ----------

  nudgeSelected(dx: number, dy: number, label?: string): void {
    if (this.selection().size === 0) return;
    this.batch(this.selection(), n => ({
      ...n,
      transform: { ...n.transform, x: n.transform.x + dx, y: n.transform.y + dy }
    }), label);
  }

  flipH(ids: ReadonlySet<string>, commitOnce = true): void {
    this.batch(ids, n => ({ ...n, transform: { ...n.transform, sx: -n.transform.sx } }), commitOnce, this.t('MENU.EDIT_FLIP_H'));
  }

  flipV(ids: ReadonlySet<string>, commitOnce = true): void {
    this.batch(ids, n => ({ ...n, transform: { ...n.transform, sy: -n.transform.sy } }), commitOnce, this.t('MENU.EDIT_FLIP_V'));
  }

  resetTransform(ids: ReadonlySet<string>): void {
    this.batch(ids, n => ({ ...n, transform: identityTransform() }), true, this.t('PROPS.RESET_TRANSFORM'));
  }

  cloneSelected(): void {
    const ids = this.selection();
    if (ids.size === 0) return;
    const cur = this.scene();
    const clones: SceneNode[] = [];
    const pushClones = (nodes: SceneNode[]) => {
      for (const n of nodes) {
        if (ids.has(n.id)) {
          const c = cloneNode(n);
          c.transform = { ...c.transform, x: c.transform.x + 16, y: c.transform.y + 16 };
          clones.push(c);
        }
      }
    };
    pushClones(cur.nodes);
    this.commit({ ...cur, nodes: [...cur.nodes, ...clones] }, this.t('PROPS.CLONE'));
    this.selection.set(new Set(clones.map(c => c.id)));
  }

  groupSelected(): SceneNode | null {
    const ids = this.selection();
    if (ids.size < 2) return null;
    const cur = this.scene();
    const orderedIndex = new Map(cur.nodes.map((n, i) => [n.id, i]));
    const memberIds = [...ids].filter(id => orderedIndex.has(id));
    if (memberIds.length < 2) return null;
    const members = memberIds
      .sort((a, b) => orderedIndex.get(a)! - orderedIndex.get(b)!)
      .map(id => cur.nodes[orderedIndex.get(id)!]);
    const insertAt = orderedIndex.get(members[0].id)!;
    const group: SceneNode = {
      id: cryptoUUID(),
      type: 'group',
      label: this.t('NODE_TYPE.GROUP') + ' ' + (cur.nodes.length - members.length + 1),
      sourceName: '',
      transform: identityTransform(),
      visible: true,
      locked: false,
      nodes: members
    };
    const rest = cur.nodes.filter(n => !ids.has(n.id));
    // members[0] is the first selected node in document order, so exactly
    // `insertAt` non-selected nodes come before the new group slot.
    const nodes = [...rest.slice(0, insertAt), group, ...rest.slice(insertAt)];
    this.commit({ ...cur, nodes }, this.t('MENU.EDIT_GROUP'));
    this.selection.set(new Set([group.id]));
    return group;
  }

  ungroup(ids: ReadonlySet<string>): void {
    const cur = this.scene();
    const nodes = cur.nodes.flatMap(n => {
      if ((n.type === 'group') && ids.has(n.id)) {
        // peel one level: compose each child's transform with the group's so
        // world positions are preserved, and assign fresh ids (spec: ungroup
        // re-uuids children).
        const composed = n.nodes.map(c => ({
          ...c,
          id: cryptoUUID(),
          transform: composeTransforms(n.transform, c.transform)
        }));
        return composed;
      }
      return [n];
    });
    const removedCount = cur.nodes.filter(n => ids.has(n.id)).length;
    if (removedCount === 0) return;
    const sel = new Set(this.selection());
    for (const id of ids) sel.delete(id);
    this.commit({ ...cur, nodes }, this.t('MENU.EDIT_UNGROUP'));
    this.selection.set(sel);
  }

  // ---------- scene lifecycle ----------

  newScene(): Scene {
    const scene = defaultScene();
    this.commit(scene, this.t('MENU.FILE_NEW'));
    this.zoom.set(1);
    return scene;
  }

  loadScene(scene: Scene, label = 'Load'): void {
    this.commit(scene, label);
    this.clearSelection();
  }

  undo(): void {
    if (this.undoStack.length === 0) return;
    this.redoStack.push(this.scene());
    this.redoLabel.set(this.undoLabel());
    const prev = this.undoStack.pop()!;
    pruneSelection(this, prev);
    this.scene.set(prev);
    this.dirty.set(true);
  }

  redo(): void {
    if (this.redoStack.length === 0) return;
    this.undoStack.push(this.scene());
    this.undoLabel.set(this.redoLabel());
    const next = this.redoStack.pop()!;
    pruneSelection(this, next);
    this.scene.set(next);
    this.dirty.set(true);
  }

  private batch(ids: ReadonlySet<string>, updater: (n: SceneNode) => SceneNode, commitOnce?: boolean, label?: string): void {
    if (ids.size === 0) return;
    const cur = this.scene();
    const mapNode = (n: SceneNode): SceneNode => {
      if (ids.has(n.id)) return updater(structuredClone(n));
      if (n.type === 'group') {
        const children = n.nodes.map(mapNode);
        if (children.some((c, i) => c !== n.nodes[i])) return { ...n, nodes: children };
      }
      return n;
    };
    this.commit({ ...cur, nodes: cur.nodes.map(mapNode) }, label);
  }

  private t(key: string): string {
    return this.translate.instant(key);
  }
}

function pruneSelection(store: SceneStore, scene: Scene): void {
  const valid = new Set(collectAllIds(scene.nodes));
  const sel = new Set<string>();
  for (const id of store.selection()) {
    if (valid.has(id)) sel.add(id);
  }
  store.selection.set(sel);
}

function collectAllIds(nodes: SceneNode[]): string[] {
  const out: string[] = [];
    const walk = (ns: SceneNode[]) => {
      for (const n of ns) {
        out.push(n.id);
        if (n.type === 'group') walk(n.nodes);
      }
    };
  walk(nodes);
  return out;
}

function cryptoUUID(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return Math.random().toString(16).slice(2);
}
