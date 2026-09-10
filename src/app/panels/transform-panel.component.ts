import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { TranslateModule } from '@ngx-translate/core';
import { SceneStore } from '../core/scene-store';
import { NodeBoundsService } from '../core/node-bounds.service';
import { DEG2RAD } from '../core/transform-math';
import { SceneNode } from '../core/models';

@Component({
  selector: 'app-transform-panel',
  standalone: true,
  imports: [
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatIconModule,
    MatTooltipModule,
    MatButtonToggleModule,
    FormsModule,
    TranslateModule,
    CommonModule,
  ],
  templateUrl: './transform-panel.component.html',
  styleUrl: './transform-panel.component.scss',
})
export class TransformPanelComponent {
  readonly store  = inject(SceneStore);
  readonly bounds = inject(NodeBoundsService);

  get hasSelection(): boolean { return this.store.selection().size > 0; }

  // Transform panel state (MVP-33)
  transformMode: 'individual' | 'global' = 'individual';

  // Translate fields
  tdx = 0;
  tdy = 0;

  // Rotate fields
  tAngle = 0;   // degrees, user-facing

  // Scale fields
  tsx  = 100;   // percent
  tsy  = 100;   // percent
  lockAspect = true;

  onTsxChange(v: number): void {
    if (this.lockAspect) this.tsy = v;
  }

  onTsyChange(v: number): void {
    if (this.lockAspect) this.tsx = v;
  }

  applyTranslate(): void {
    const dx = this.tdx;
    const dy = this.tdy;
    if (dx === 0 && dy === 0) return;
    this.store.batchTransform(
      this.store.selection(),
      n => ({ ...n.transform, x: n.transform.x + dx, y: n.transform.y + dy }),
      'Move',
    );
  }

  applyRotate(): void {
    const deltaRad = this.tAngle * DEG2RAD;
    if (deltaRad === 0) return;
    const nodes = this.selectedNodes();
    if (nodes.length === 0) return;

    if (this.transformMode === 'individual') {
      this.store.batchTransform(
        this.store.selection(),
        n => ({ ...n.transform, r: n.transform.r + deltaRad }),
        'Rotate',
      );
    } else {
      const cx = nodes.reduce((s, n) => s + this.bounds.centre(n).x, 0) / nodes.length;
      const cy = nodes.reduce((s, n) => s + this.bounds.centre(n).y, 0) / nodes.length;
      const cos = Math.cos(deltaRad);
      const sin = Math.sin(deltaRad);
      this.store.batchTransform(
        this.store.selection(),
        n => {
          const dx = n.transform.x - cx;
          const dy = n.transform.y - cy;
          return {
            ...n.transform,
            r: n.transform.r + deltaRad,
            x: cx + dx * cos - dy * sin,
            y: cy + dx * sin + dy * cos,
          };
        },
        'Rotate (group)',
      );
    }
  }

  applyScale(): void {
    const fx = this.tsx / 100;
    const fy = this.tsy / 100;
    if (fx === 1 && fy === 1) return;
    const nodes = this.selectedNodes();
    if (nodes.length === 0) return;

    if (this.transformMode === 'individual') {
      this.store.batchTransform(
        this.store.selection(),
        n => ({ ...n.transform, sx: n.transform.sx * fx, sy: n.transform.sy * fy }),
        'Scale',
      );
    } else {
      const cx = nodes.reduce((s, n) => s + this.bounds.centre(n).x, 0) / nodes.length;
      const cy = nodes.reduce((s, n) => s + this.bounds.centre(n).y, 0) / nodes.length;
      this.store.batchTransform(
        this.store.selection(),
        n => {
          const newX = cx + (n.transform.x - cx) * fx;
          const newY = cy + (n.transform.y - cy) * fy;
          return {
            ...n.transform,
            sx: n.transform.sx * fx,
            sy: n.transform.sy * fy,
            x: newX,
            y: newY,
          };
        },
        'Scale (group)',
      );
    }
  }

  resetFields(): void {
    this.tdx = 0; this.tdy = 0;
    this.tAngle = 0;
    this.tsx = 100; this.tsy = 100;
  }

  private selectedNodes(): SceneNode[] {
    const ids = this.store.selection();
    return this.store.scene().nodes.filter(n => ids.has(n.id));
  }
}
