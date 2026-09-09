import { Injectable, signal, inject } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';

export interface Toast {
  id: number;
  message: string;
  variant: 'info' | 'error' | 'success';
}

let nextId = 1;

export interface ToastParams {
  duration?: number;
}

@Injectable({ providedIn: 'root' })
export class ToastService {
  private readonly translate = inject(TranslateService);

  toasts = signal<Toast[]>([]);

  toast(messageKey: string, variant: Toast['variant'] = 'info', params?: ToastParams): void {
    const message = this.translate.instant(messageKey);
    const id = nextId++;
    this.toasts.update(list => [...list, { id, message, variant }]);
    setTimeout(() => {
      this.toasts.update(list => list.filter(t => t.id !== id));
    }, params?.duration ?? 3500);
  }

  info(messageKey: string, params?: ToastParams): void {
    this.toast(messageKey, 'info', params);
  }

  success(messageKey: string, params?: ToastParams): void {
    this.toast(messageKey, 'success', params);
  }

  error(messageKey: string, params?: ToastParams): void {
    this.toast(messageKey, 'error', params);
  }
}
