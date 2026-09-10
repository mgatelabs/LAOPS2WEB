import { Component, Inject } from '@angular/core';
import { MatDialogRef, MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { FormsModule } from '@angular/forms';
import { TranslateModule } from '@ngx-translate/core';
import { CanvasSettings, Color } from '../core/models';

export interface CanvasSettingsDialogData {
  canvas: CanvasSettings;
}

export interface CanvasSettingsResult {
  width: number;
  height: number;
  backgroundColor: Color;
  transparentBackground: boolean;
}

function hexToRgb(hex: string): Color {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return [255, 255, 255];
  const v = parseInt(m[1], 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

function rgbToHex(c: Color): string {
  const h = (n: number) => n.toString(16).padStart(2, '0');
  return `#${h(c[0])}${h(c[1])}${h(c[2])}`;
}

@Component({
  selector: 'app-canvas-settings-dialog',
  standalone: true,
  imports: [
    MatDialogModule,
    MatButtonModule,
    MatCheckboxModule,
    MatFormFieldModule,
    MatInputModule,
    FormsModule,
    TranslateModule,
  ],
  template: `
    <div class="canvas-settings-dialog">
      <h2 mat-dialog-title>{{ 'DIALOG.CANVAS_SETTINGS' | translate }}</h2>
      <mat-dialog-content>
        <div class="size-row">
          <mat-form-field appearance="outline" class="size-field">
            <mat-label>{{ 'DIALOG.CANVAS_WIDTH' | translate }}</mat-label>
            <input matInput type="number" min="100" [(ngModel)]="width" />
          </mat-form-field>
          <mat-form-field appearance="outline" class="size-field">
            <mat-label>{{ 'DIALOG.CANVAS_HEIGHT' | translate }}</mat-label>
            <input matInput type="number" min="100" [(ngModel)]="height" />
          </mat-form-field>
        </div>
        <mat-checkbox [(ngModel)]="transparent" class="transparent-check">
          {{ 'DIALOG.EXPORT_PNG_TRANSPARENT' | translate }}
        </mat-checkbox>
        <div class="color-section" [class.disabled]="transparent">
          <span class="color-label">{{ 'DIALOG.CANVAS_BACKGROUND' | translate }}</span>
          <div class="color-row">
            <input type="color" class="color-swatch"
                   [value]="bgHex"
                   [disabled]="transparent"
                   (input)="bgHex = $any($event.target).value" />
            <span class="color-hex">{{ bgHex }}</span>
          </div>
        </div>
      </mat-dialog-content>
      <mat-dialog-actions align="end">
        <button mat-button (click)="cancel()">{{ 'DIALOG.CANCEL' | translate }}</button>
        <button mat-flat-button color="primary" (click)="confirm()">{{ 'DIALOG.OK' | translate }}</button>
      </mat-dialog-actions>
    </div>
  `,
  styles: [`
    .canvas-settings-dialog { padding: 8px 4px 4px; min-width: 300px; }
    .size-row { display: flex; gap: 8px; margin-bottom: 4px; margin-top: 6px; }
    .size-field { flex: 1; }
    .transparent-check { display: block; margin: 8px 0; }
    .color-section {
      margin: 12px 0 8px;
      &.disabled { opacity: 0.4; pointer-events: none; }
    }
    .color-label {
      display: block;
      font-size: 12px;
      color: var(--mdc-outlined-text-field-label-text-color);
      margin-bottom: 6px;
    }
    .color-row {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .color-swatch {
      width: 48px;
      height: 32px;
      padding: 2px;
      border: 2px solid var(--laops-border);
      border-radius: 4px;
      cursor: pointer;
      background: none;
      outline: 1px solid var(--laops-border);
      outline-offset: -3px;
    }
    .color-hex {
      font-size: 13px;
      font-family: monospace;
      opacity: 0.8;
    }
    mat-dialog-content { padding-top: 20px; }
  `],
})
export class CanvasSettingsDialogComponent {
  width: number;
  height: number;
  bgHex: string;
  transparent: boolean;

  constructor(
    private readonly dialogRef: MatDialogRef<CanvasSettingsDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: CanvasSettingsDialogData,
  ) {
    this.width = data.canvas.width;
    this.height = data.canvas.height;
    this.bgHex = rgbToHex(data.canvas.backgroundColor);
    this.transparent = !!data.canvas.transparentBackground;
  }

  confirm(): void {
    const result: CanvasSettingsResult = {
      width: Math.max(100, Math.round(this.width) || 100),
      height: Math.max(100, Math.round(this.height) || 100),
      backgroundColor: hexToRgb(this.bgHex),
      transparentBackground: this.transparent,
    };
    this.dialogRef.close(result);
  }

  cancel(): void {
    this.dialogRef.close(undefined);
  }
}
