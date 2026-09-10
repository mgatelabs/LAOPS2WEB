import { Injectable, signal } from '@angular/core';

export type ZoomAction = 'in' | 'out' | 'reset' | 'fit';

/**
 * One-shot view actions from the menu bar to the canvas (MVP-82).
 *
 * The View menu (menu bar) and the canvas live in different components, so
 * the action is handed off via a signal. The consumer (CanvasComponent)
 * applies it in an injected effect and does not clear it — each setter
 * schedules a self-clear after one microtask so an action is consumed at
 * most once, even if the effect re-runs.
 */
@Injectable({ providedIn: 'root' })
export class ViewStateService {
  private readonly _zoomAction = signal<ZoomAction | null>(null);

  /** Pending zoom action; null when nothing is queued. */
  readonly zoomAction = this._zoomAction.asReadonly();

  zoomIn(): void { this.dispatch('in'); }
  zoomOut(): void { this.dispatch('out'); }
  zoomReset(): void { this.dispatch('reset'); }
  zoomFit(): void { this.dispatch('fit'); }

  private dispatch(action: ZoomAction): void {
    this._zoomAction.set(action);
    // Clear on the next microtask, after the consuming effect has run.
    Promise.resolve().then(() => this._zoomAction.set(null));
  }
}
