import { Injectable, signal, computed } from '@angular/core';

export type ToolId = 'select' | 'move' | 'scale' | 'rotate' | 'pivot' | 'pan' | 'rect' | 'ellipse' | 'text';

export interface ToolDef {
  id: ToolId;
  icon: string;
  key: string;
}

export const TOOLS: ToolDef[] = [
  { id: 'select', icon: 'arrow_selector_tool', key: 'TOOL.SELECT' },
  { id: 'move', icon: 'open_with', key: 'TOOL.MOVE' },
  { id: 'scale', icon: 'aspect_ratio', key: 'TOOL.SCALE' },
  { id: 'rotate', icon: 'rotate_right', key: 'TOOL.ROTATE' },
  { id: 'pivot', icon: 'center_focus_strong', key: 'TOOL.PIVOT' },
  { id: 'pan', icon: 'pan_tool', key: 'TOOL.PAN' },
  { id: 'rect', icon: 'rectangle', key: 'TOOL.RECT' },
  { id: 'ellipse', icon: 'ellipse', key: 'TOOL.ELLIPSE' },
  { id: 'text', icon: 'textbox', key: 'TOOL.TEXT' }
];

@Injectable({ providedIn: 'root' })
export class ToolService {
  tool = signal<ToolId>('select');
  readonly activeTool = computed(() => this.tool());
  readonly keyboardShortcut = signal(false);

  select(id: ToolId): void {
    this.tool.set(id);
  }

  toolDef(id: ToolId): ToolDef {
    return TOOLS.find(t => t.id === id) ?? TOOLS[0];
  }

  cycleShortcut(on: boolean): void {
    this.keyboardShortcut.set(on);
  }
}
