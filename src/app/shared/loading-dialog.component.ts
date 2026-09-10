import { Component, Inject } from '@angular/core';
import { MatDialogRef, MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { TranslateModule } from '@ngx-translate/core';

export interface LoadingDialogData {
  loaded: number;
  total: number;
}

@Component({
  selector: 'app-loading-dialog',
  standalone: true,
  imports: [MatDialogModule, MatProgressBarModule, TranslateModule],
  template: `
    <div class="loading-dialog">
      <h2 class="title">{{ 'LOADING.TITLE' | translate }}</h2>
      <p class="subtitle">{{ 'LOADING.SUBTITLE' | translate }}</p>
      <mat-progress-bar mode="determinate" [value]="progress"></mat-progress-bar>
      <p class="counter">
        {{ 'LOADING.PROGRESS' | translate: { loaded: data.loaded, total: data.total } }}
      </p>
    </div>
  `,
  styles: [`
    .loading-dialog {
      padding: 24px 28px 20px;
      min-width: 320px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .title {
      margin: 0;
      font-size: 16px;
      font-weight: 500;
    }
    .subtitle {
      margin: 0;
      font-size: 13px;
      opacity: 0.7;
    }
    .counter {
      margin: 4px 0 0;
      font-size: 12px;
      opacity: 0.6;
      text-align: right;
    }
    mat-progress-bar {
      border-radius: 2px;
    }
  `],
})
export class LoadingDialogComponent {
  constructor(
    public dialogRef: MatDialogRef<LoadingDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: LoadingDialogData,
  ) {
    dialogRef.disableClose = true;
  }

  get progress(): number {
    return this.data.total > 0 ? (this.data.loaded / this.data.total) * 100 : 0;
  }
}
