import { Component, Inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatDialogRef, MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { ReactiveFormsModule, NonNullableFormBuilder, Validators } from '@angular/forms';
import { TranslateModule } from '@ngx-translate/core';

export interface ExportPngDialogData {
  scale: number;
  transparent: boolean;
  defaultFilename: string;
  canvasWidth: number;
  canvasHeight: number;
}

export interface ExportPngResult {
  scale: number;
  transparent: boolean;
  filename: string;
}

@Component({
  selector: 'app-export-png-dialog',
  standalone: true,
  imports: [
    MatDialogModule,
    MatButtonModule,
    MatCheckboxModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    ReactiveFormsModule,
    CommonModule,
    TranslateModule,
  ],
  template: `
    <div class="export-png-dialog">
      <h2 mat-dialog-title>{{ 'DIALOG.EXPORT_PNG' | translate }}</h2>
      <mat-dialog-content>
        <form [formGroup]="form" class="export-form">
          <mat-form-field appearance="fill" class="scale-field">
            <mat-label>{{ 'DIALOG.EXPORT_PNG_SCALE' | translate }}</mat-label>
            <mat-select formControlName="scale">
              @for (p of scalePresets; track p) {
                <mat-option [value]="p">{{ (p * 100) | number:'1.0-0' }}%</mat-option>
              }
            </mat-select>
          </mat-form-field>
          <div class="dimensions-label">{{ 'DIALOG.EXPORT_PNG_DIMENSIONS' | translate: dimensions() }}</div>
          <mat-form-field appearance="fill" class="filename-field">
            <mat-label>{{ 'DIALOG.EXPORT_PNG_FILENAME' | translate }}</mat-label>
            <input matInput formControlName="filename" />
          </mat-form-field>
          <mat-checkbox formControlName="transparent" class="transparent-check">
            {{ 'DIALOG.EXPORT_PNG_TRANSPARENT' | translate }}
          </mat-checkbox>
        </form>
      </mat-dialog-content>
      <mat-dialog-actions align="end">
        <button mat-button (click)="cancel()">{{ 'DIALOG.CANCEL' | translate }}</button>
        <button mat-flat-button color="primary" (click)="confirm()" [disabled]="form.invalid">
          {{ 'DIALOG.OK' | translate }}
        </button>
      </mat-dialog-actions>
    </div>
  `,
  styles: [`
    .export-png-dialog { padding: 8px 4px 4px; min-width: 300px; }
    .export-form { display: flex; flex-direction: column; }
    .scale-field { width: 100%; }
    .dimensions-label { margin: 4px 0 4px 16px; font-size: 12px; opacity: 0.8; }
    .filename-field { width: 100%; margin-bottom: 4px; }
    .transparent-check { display: block; }
    mat-dialog-content { padding-top: 8px; }
  `],
})
export class ExportPngDialogComponent {
  readonly scalePresets = [0.5, 1, 2, 3, 4];

  readonly form;

  constructor(
    private readonly dialogRef: MatDialogRef<ExportPngDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: ExportPngDialogData,
    fb: NonNullableFormBuilder,
  ) {
    this.form = fb.group({
      scale: [data.scale, Validators.min(0.1)],
      filename: [data.defaultFilename, Validators.required],
      transparent: [data.transparent],
    });
  }

  dimensions(): { w: number; h: number } {
    const s = this.form.get('scale')?.value ?? 1;
    return {
      w: Math.round(this.data.canvasWidth * s),
      h: Math.round(this.data.canvasHeight * s),
    };
  }

  confirm(): void {
    if (this.form.invalid) return;
    const result: ExportPngResult = {
      scale: this.form.get('scale')?.value ?? 1,
      transparent: this.form.get('transparent')?.value ?? false,
      filename: this.form.get('filename')?.value ?? '',
    };
    this.dialogRef.close(result);
  }

  cancel(): void {
    this.dialogRef.close(undefined);
  }
}
