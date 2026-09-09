import { Injectable, signal } from '@angular/core';

export type ToolId =
  | 'select' | 'move' | 'scale' | 'rotate'
  | 'pivot'  | 'pan'  | 'rect'  | 'ellipse' | 'text';

@Injectable({ providedIn: 'root' })
export class ToolStateService {
  readonly activeTool = signal<ToolId>('select');

  setTool(id: ToolId): void {
    this.activeTool.set(id);
  }
}
