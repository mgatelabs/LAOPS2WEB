import { Component } from '@angular/core';
import { MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatDividerModule } from '@angular/material/divider';
import { TranslateModule } from '@ngx-translate/core';

@Component({
  selector: 'app-about-dialog',
  standalone: true,
  imports: [MatDialogModule, MatButtonModule, MatDividerModule, TranslateModule],
  template: `
    <h2 mat-dialog-title>{{ 'ABOUT.TITLE' | translate }}</h2>
    <mat-dialog-content>
      <p class="app-name">{{ 'APP.TITLE' | translate }}</p>
      <p class="app-desc">{{ 'ABOUT.DESCRIPTION' | translate }}</p>
      <p class="version">{{ 'ABOUT.VERSION' | translate }}</p>
      <mat-divider style="margin: 12px 0" />
      <p class="attribution">{{ 'ABOUT.BASED_ON' | translate }}</p>
      <a class="source-link" href="https://github.com/mgatelabs/LAOPS" target="_blank" rel="noopener">
        github.com/mgatelabs/LAOPS
      </a>
      <p class="attribution">{{ 'ABOUT.ORIGINAL' | translate }}</p>
      <mat-divider style="margin: 12px 0" />
      <p class="attribution">{{ 'ABOUT.SOURCE' | translate }}</p>
      <a class="source-link" href="https://github.com/mgatelabs/LAOPS2WEB" target="_blank" rel="noopener">
        github.com/mgatelabs/LAOPS2WEB
      </a>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-flat-button color="primary" mat-dialog-close>
        {{ 'DIALOG.OK' | translate }}
      </button>
    </mat-dialog-actions>
  `,
  styles: [`
    mat-dialog-content { display: flex; flex-direction: column; gap: 6px; }
    .app-name    { font-size: 18px; font-weight: 600; margin: 0; }
    .app-desc    { margin: 0; opacity: 0.8; }
    .version     { margin: 0; font-size: 12px; opacity: 0.5; font-family: monospace; }
    .attribution { margin: 0; font-size: 13px; opacity: 0.75; }
    .source-link { font-size: 12px; opacity: 0.7; }
  `],
})
export class AboutDialogComponent {}
