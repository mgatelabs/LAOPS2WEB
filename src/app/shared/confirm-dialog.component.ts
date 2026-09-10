import { Component, Inject } from '@angular/core';
import { MatDialogRef, MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { TranslateModule } from '@ngx-translate/core';

export interface ConfirmDialogData {
  message: string;
}

@Component({
  selector: 'app-confirm-dialog',
  standalone: true,
  imports: [MatDialogModule, MatButtonModule, TranslateModule],
  template: `
    <div class="confirm-dialog">
      <h2 mat-dialog-title>{{ 'DIALOG.CONFIRM' | translate }}</h2>
      <mat-dialog-content>
        <p class="message">{{ message }}</p>
      </mat-dialog-content>
      <mat-dialog-actions align="end">
        <button mat-button (click)="cancel()">{{ 'DIALOG.CANCEL' | translate }}</button>
        <button mat-flat-button color="primary" (click)="confirm()">{{ 'DIALOG.OK' | translate }}</button>
      </mat-dialog-actions>
    </div>
  `,
  styles: [`
    .confirm-dialog { padding: 8px 4px 4px; min-width: 300px; }
    .message { margin: 8px 0 0; font-size: 14px; }
  `],
})
export class ConfirmDialogComponent {
  constructor(
    public dialogRef: MatDialogRef<ConfirmDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: ConfirmDialogData,
  ) {}

  get message(): string { return this.data.message; }

  confirm(): void {
    this.dialogRef.close(true);
  }

  cancel(): void {
    this.dialogRef.close(false);
  }
}
