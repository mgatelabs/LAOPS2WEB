import { Injectable, signal, computed, inject, DestroyRef } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';
import {
  Scene, SceneNode, CanvasSettings, Transform,
  MultiColorObjectNode, MultiColorPart,
  defaultScene, IDENTITY_TRANSFORM
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

  private readonly undoStack: { scene: Scene; label: string | null }[] = [];
  private readonly redoStack: { scene: Scene; label: string | null }[] = [];

  readonly canUndo = signal(false);
  readonly canRedo = signal(false);

  readonly selectedNodes = computed<SceneNode[]>(() => this.scene().nodes.filter(n => this.selection().has(n.id)));

  readonly zoom = signal(1);

  undoLabel = signal<string | null>(null);
  redoLabel = signal<string | null>(null);

  // MVP-81: bumped after a loadScene/open-import so the canvas re-injects
  // SVGs whose data-svg-rendered marker outlived the load while the SVG
  // cache only got populated mid-load.
  readonly svgReinjectTick = signal(0);

  triggerSvgReinject(): void {
    this.svgReinjectTick.update(n => n + 1);
  }

  private activeGesture: { undoIndex: number; label: string } | null = null;

  constructor() {
    this.destroyRef.onDestroy(() => {
      this.undoStack.length = 0;
      this.redoStack.length = 0;
      this.syncUndoRedoState();
    });
  }

  private syncUndoRedoState(): void {
    this.canUndo.set(this.undoStack.length > 0);
    this.canRedo.set(this.redoStack.length > 0);
  }

  // ---------- core ----------

  commit(next: Scene, label?: string): void {
    if (this.activeGesture && this.activeGesture.undoIndex < 0) {
      // First commit of a gesture — mark the pre-gesture state as its undo
      // entry. Commits after this skip the push, so the whole gesture
      // collapses into a single undo step.
      this.undoStack.push({ scene: this.scene(), label: this.activeGesture.label });
      if (this.undoStack.length > MAX_UNDO) this.undoStack.shift();
      this.activeGesture.undoIndex = this.undoStack.length - 1;
      this.undoLabel.set(this.activeGesture.label);
    } else if (!this.activeGesture) {
      this.undoStack.push({ scene: this.scene(), label: label ?? null });
      if (this.undoStack.length > MAX_UNDO) this.undoStack.shift();
      this.undoLabel.set(label ?? null);
    }
    this.redoStack.length = 0;
    this.redoLabel.set(null);
    pruneSelection(this, next);
    this.scene.update(() => next);
    this.dirty.set(true);
    this.syncUndoRedoState();
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

  addNodes(nodes: SceneNode[], label?: string): void {
    if (nodes.length === 0) return;
    const cur = this.scene();
    this.commit({ ...cur, nodes: [...cur.nodes, ...nodes] }, label);
    this.selection.set(new Set(nodes.map(n => n.id)));
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

  updateTransform(id: string, transform: Transform): void {
    this.updateNode(id, n => ({ ...n, transform }));
  }

  findNode(id: string): SceneNode | undefined {
    const search = (nodes: SceneNode[]): SceneNode | undefined => {
      for (const n of nodes) {
        if (n.id === id) return n;
        if (n.type === 'group') {
          const found = search(n.nodes);
          if (found) return found;
        }
      }
      return undefined;
    };
    return search(this.scene().nodes);
  }

  updateMultiColorPart(nodeId: string, partId: string, patch: Partial<MultiColorPart>): void {
    this.updateNode(nodeId, n => {
      if (n.type !== 'multicolor-object') return n;
      const mc = n as MultiColorObjectNode;
      const existing = mc.parts.find(p => p.id === partId);
      let newParts: MultiColorPart[];
      if (existing) {
        newParts = mc.parts.map(p =>
          p.id === partId ? { ...p, ...patch } : p
        );
      } else {
        newParts = [...mc.parts, { id: partId, ...patch }];
      }
      return { ...mc, parts: newParts } as SceneNode;
    });
  }

  resetMultiColorParts(nodeId: string): void {
    this.updateNode(nodeId, n => {
      if (n.type !== 'multicolor-object') return n;
      return { ...(n as MultiColorObjectNode), parts: [] } as SceneNode;
    });
  }

  batchTransform(
    ids: ReadonlySet<string>,
    updater: (n: SceneNode) => Transform,
    label?: string,
  ): void {
    this.batch(ids, n => ({ ...n, transform: updater(n) }), true, label);
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
    }), undefined, label);
  }

  flipH(ids: ReadonlySet<string>, commitOnce = true): void {
    this.batch(ids, n => ({ ...n, transform: { ...n.transform, sx: -n.transform.sx } }), commitOnce, this.t('MENU.EDIT_FLIP_H'));
  }

  flipV(ids: ReadonlySet<string>, commitOnce = true): void {
    this.batch(ids, n => ({ ...n, transform: { ...n.transform, sy: -n.transform.sy } }), commitOnce, this.t('MENU.EDIT_FLIP_V'));
  }

  lockNodes(ids: ReadonlySet<string>): void {
    if (ids.size === 0) return;
    const cur = this.scene();
    const nodes = cur.nodes.map(n => ids.has(n.id) ? { ...n, locked: true } : n);
    this.commit({ ...cur, nodes }, this.t('EDIT.LOCK'));
    // A locked node cannot be selected — drop it from the current selection.
    const sel = new Set(this.selection());
    for (const id of ids) sel.delete(id);
    this.selection.set(sel);
  }

  resetTransform(ids: ReadonlySet<string>): void {
    this.batch(ids, n => ({ ...n, transform: { ...IDENTITY_TRANSFORM } }), true, this.t('PROPS.RESET_TRANSFORM'));
  }

  setVisibility(ids: ReadonlySet<string>, visible: boolean): void {
    this.batch(
      ids,
      n => ({ ...n, visible }),
      true,
      visible ? this.t('LAYERS.SHOW_SELECTED') : this.t('LAYERS.HIDE_SELECTED'),
    );
  }

  cloneSelected(): void {
    const ids = this.selection();
    if (ids.size === 0) return;
    const cur = this.scene();
    const clones: SceneNode[] = [];
    const pushClones = (nodes: SceneNode[]) => {
      for (const n of nodes) {
        if (ids.has(n.id)) {
          const c = structuredClone(n) as SceneNode;
          c.id = cryptoUUID();
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
      transform: { ...IDENTITY_TRANSFORM },
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

  // ---------- gestures (single undo step per pointer interaction) ----------

  snapshot(): Map<string, SceneNode> {
    const out = new Map<string, SceneNode>();
    const walk = (ns: SceneNode[]): void => {
      for (const n of ns) {
        if (!out.has(n.id)) out.set(n.id, structuredClone(n));
        if (n.type === 'group') walk(n.nodes);
      }
    };
    walk(this.scene().nodes);
    return out;
  }

  beginGesture(label: string): void {
    this.activeGesture = { undoIndex: -1, label };
  }

  endGesture(): void {
    // If the gesture committed at least once, its first commit already pushed
    // the pre-gesture snapshot with this label — the stack is in final shape.
    // If it never committed, the stack was never touched — nothing to restore.
    this.activeGesture = null;
  }

  undo(): void {
    if (this.undoStack.length === 0) return;
    this.activeGesture = null;
    const prev = this.undoStack.pop()!;
    this.redoStack.push({ scene: this.scene(), label: prev.label });
    this.undoLabel.set(
      this.undoStack.length ? this.undoStack[this.undoStack.length - 1].label : null,
    );
    this.redoLabel.set(prev.label);
    pruneSelection(this, prev.scene);
    this.scene.set(prev.scene);
    this.dirty.set(true);
    this.syncUndoRedoState();
  }

  redo(): void {
    if (this.redoStack.length === 0) return;
    this.activeGesture = null;
    const next = this.redoStack.pop()!;
    this.undoStack.push({ scene: this.scene(), label: next.label });
    if (this.undoStack.length > MAX_UNDO) this.undoStack.shift();
    this.undoLabel.set(next.label);
    this.redoLabel.set(
      this.redoStack.length ? this.redoStack[this.redoStack.length - 1].label : null,
    );
    pruneSelection(this, next.scene);
    this.scene.set(next.scene);
    this.dirty.set(true);
    this.syncUndoRedoState();
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
