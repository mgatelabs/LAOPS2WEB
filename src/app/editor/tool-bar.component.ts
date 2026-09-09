import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TranslateModule } from '@ngx-translate/core';
import { ToolStateService, ToolId } from '../tools/tool-state.service';

interface ToolDef {
  id: string;
  icon: string;
  key: string;
}

const TOOLS: ToolDef[] = [
  { id: 'select', icon: 'arrow_selector_tool', key: 'TOOL.SELECT' },
  { id: 'move', icon: 'open_with', key: 'TOOL.MOVE' },
  { id: 'scale', icon: 'aspect_ratio', key: 'TOOL.SCALE' },
  { id: 'rotate', icon: 'rotate_right', key: 'TOOL.ROTATE' },
  { id: 'pivot', icon: 'control_camera', key: 'TOOL.PIVOT' },
  { id: 'pan', icon: 'pan_tool', key: 'TOOL.PAN' },
  { id: 'rect', icon: 'rectangle', key: 'TOOL.RECT' },
  { id: 'ellipse', icon: 'circle', key: 'TOOL.ELLIPSE' },
  { id: 'text', icon: 'title', key: 'TOOL.TEXT' },
];

@Component({
  selector: 'app-tool-bar',
  standalone: true,
  imports: [MatButtonModule, MatIconModule, MatTooltipModule, TranslateModule, CommonModule],
  templateUrl: './tool-bar.component.html',
  styleUrl: './tool-bar.component.scss',
})
export class ToolBarComponent {
  readonly tools = TOOLS;

  constructor(readonly toolState: ToolStateService) {}

  selectTool(id: string): void {
    this.toolState.setTool(id as ToolId);
  }
}
