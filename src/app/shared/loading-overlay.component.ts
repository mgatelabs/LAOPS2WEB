import { Component, input } from '@angular/core';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { TranslateModule } from '@ngx-translate/core';

@Component({
  selector: 'app-loading-overlay',
  standalone: true,
  imports: [MatProgressSpinnerModule, TranslateModule],
  template: `
    @if (visible()) {
      <div class="overlay">
        <div class="overlay-card">
          <mat-spinner diameter="36" />
          <span>{{ message() | translate }}</span>
        </div>
      </div>
    }
  `,
  styles: [`
    :host {
      display: block;
    }
    .overlay {
      position: fixed; inset: 0;
      background: rgba(0,0,0,0.45);
      display: flex; align-items: center; justify-content: center;
      z-index: 9999;
    }
    .overlay-card {
      background: var(--mdc-dialog-container-color);
      color: var(--mdc-dialog-supporting-text-color);
      border-radius: 8px;
      padding: 24px 32px;
      display: flex; flex-direction: column;
      align-items: center; gap: 16px;
      min-width: 160px;
      box-shadow: 0 4px 24px rgba(0,0,0,0.3);
      font-size: 14px;
    }
  `],
})
export class LoadingOverlayComponent {
  readonly visible = input<boolean>(false);
  readonly message = input<string>('LOADING.PLEASE_WAIT');
}
