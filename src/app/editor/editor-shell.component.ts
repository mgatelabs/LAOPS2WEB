import { Component } from '@angular/core';
import { MenuBarComponent } from './menu-bar.component';
import { ToolBarComponent } from './tool-bar.component';
import { CanvasComponent } from './canvas.component';
import { RightPanelHostComponent } from './right-panel-host.component';

@Component({
  selector: 'app-editor-shell',
  standalone: true,
  imports: [MenuBarComponent, ToolBarComponent, CanvasComponent, RightPanelHostComponent],
  templateUrl: './editor-shell.component.html',
  styleUrl: './editor-shell.component.scss'
})
export class EditorShellComponent {}
