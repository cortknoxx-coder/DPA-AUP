import { Injectable, signal } from '@angular/core';

export type ToastKind = 'info' | 'success' | 'warning' | 'danger';

export interface Toast {
  id: number;
  kind: ToastKind;
  title: string;
  description?: string;
  durationMs: number;
}

@Injectable({ providedIn: 'root' })
export class ToastService {
  readonly toasts = signal<Toast[]>([]);
  private nextId = 1;

  push(toast: Omit<Toast, 'id' | 'durationMs'> & { durationMs?: number }): number {
    const id = this.nextId++;
    const item: Toast = { id, durationMs: 4500, ...toast };
    this.toasts.update((list) => [...list, item]);
    if (item.durationMs > 0) {
      setTimeout(() => this.dismiss(id), item.durationMs);
    }
    return id;
  }

  info(title: string, description?: string) { return this.push({ kind: 'info', title, description }); }
  success(title: string, description?: string) { return this.push({ kind: 'success', title, description }); }
  warn(title: string, description?: string) { return this.push({ kind: 'warning', title, description }); }
  danger(title: string, description?: string) { return this.push({ kind: 'danger', title, description }); }

  dismiss(id: number) {
    this.toasts.update((list) => list.filter((t) => t.id !== id));
  }
}
