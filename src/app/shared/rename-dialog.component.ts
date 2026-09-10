import { Component, Inject, OnInit } from '@angular/core';
import { MatDialogRef, MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { FormsModule } from '@angular/forms';
import { TranslateModule } from '@ngx-translate/core';

export interface RenameDialogData {
  name: string;
}

@Component({
  selector: 'app-rename-dialog',
  standalone: true,
  imports: [MatDialogModule, MatButtonModule, MatFormFieldModule, MatInputModule, FormsModule, TranslateModule],
  template: `
    <div class="rename-dialog">
      <h2 mat-dialog-title>{{ 'DIALOG.RENAME_SCENE' | translate }}</h2>
      <mat-dialog-content>
        <mat-form-field appearance="fill" class="full-width">
          <mat-label>{{ 'DIALOG.SCENE_NAME' | translate }}</mat-label>
          <input matInput [(ngModel)]="name" (keydown.enter)="confirm()" #nameInput />
        </mat-form-field>
      </mat-dialog-content>
      <mat-dialog-actions align="end">
        <button mat-button (click)="cancel()">{{ 'DIALOG.CANCEL' | translate }}</button>
        <button mat-flat-button color="primary" (click)="confirm()" [disabled]="!name.trim()">
          {{ 'DIALOG.OK' | translate }}
        </button>
      </mat-dialog-actions>
    </div>
  `,
  styles: [`
    .rename-dialog { padding: 8px 4px 4px; min-width: 280px; }
    .full-width { width: 100%; }
    mat-dialog-content { padding-top: 8px; }
  `],
})
export class RenameDialogComponent implements OnInit {
  name: string;

  constructor(
    public dialogRef: MatDialogRef<RenameDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: RenameDialogData,
  ) {
    this.name = data.name;
  }

  ngOnInit(): void {
    // Select all text on open so user can just start typing
    setTimeout(() => {
      const input = document.querySelector('.rename-dialog input') as HTMLInputElement;
      input?.select();
    });
  }

  confirm(): void {
    if (!this.name.trim()) return;
    this.dialogRef.close(this.name);
  }

  cancel(): void {
    this.dialogRef.close(undefined);
  }
}
