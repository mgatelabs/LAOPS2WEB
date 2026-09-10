import { Component, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatDividerModule } from '@angular/material/divider';
import { TranslateModule } from '@ngx-translate/core';
import { SceneStore } from '../core/scene-store';
import { SceneNode, PrimitiveNode } from '../core/models';

@Component({
  selector: 'app-layers-panel',
  standalone: true,
  imports: [
    CommonModule,
    MatCheckboxModule,
    MatButtonModule,
    MatIconModule,
    MatTooltipModule,
    MatDividerModule,
    TranslateModule,
  ],
  templateUrl: './layers-panel.component.html',
  styleUrl: './layers-panel.component.scss',
})
export class LayersPanelComponent {
  readonly store = inject(SceneStore);

  // Reversed so top of list = topmost on canvas
  readonly displayNodes = computed(() => [...this.store.scene().nodes].reverse());

  readonly hasMultiSelection = computed(() => this.store.selection().size > 1);

  typeIcon(node: SceneNode): string {
    switch (node.type) {
      case 'svg-object':        return 'image';
      case 'multicolor-object': return 'palette';
      case 'primitive':
        switch ((node as PrimitiveNode).shape) {
          case 'ellipse': return 'radio_button_unchecked';
          case 'polygon': return 'pentagon';
          default:        return 'crop_square';
        }
      case 'text':  return 'title';
      case 'group': return 'folder';
      default:      return 'layers';
    }
  }

  isSelected(id: string): boolean {
    return this.store.selection().has(id);
  }

  onRowClick(e: MouseEvent, node: SceneNode): void {
    if (e.shiftKey) {
      this.store.toggleSelected(node.id);
    } else {
      this.store.setSelected(new Set([node.id]));
    }
  }

  toggleVisibility(e: MouseEvent, node: SceneNode): void {
    e.stopPropagation();
    this.store.updateNode(node.id, n => ({ ...n, visible: !n.visible }));
  }

  toggleLock(e: MouseEvent, node: SceneNode): void {
    e.stopPropagation();
    this.store.updateNode(node.id, n => ({ ...n, locked: !n.locked }));
  }

  moveUp(e: MouseEvent, node: SceneNode): void {
    e.stopPropagation();
    this.store.moveUp(new Set([node.id]));
  }

  moveDown(e: MouseEvent, node: SceneNode): void {
    e.stopPropagation();
    this.store.moveDown(new Set([node.id]));
  }

  deleteSelected(): void {
    this.store.removeNodes(this.store.selection());
  }
}
