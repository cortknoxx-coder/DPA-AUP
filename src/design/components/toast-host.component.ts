import { Component, inject } from '@angular/core';
import { ToastService } from './toast.service';

@Component({
  selector: 'dpa-toast-host',
  standalone: true,
  template: `
    <div class="toast-stack">
      @for (t of toastService.toasts(); track t.id) {
        <div class="toast" [attr.data-kind]="t.kind">
          <div class="mt-0.5 shrink-0" [style.color]="kindColor(t.kind)">
            @switch (t.kind) {
              @case ('success') { <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 6L9 17l-5-5"/></svg> }
              @case ('warning') { <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><path d="M12 9v4M12 17h.01"/></svg> }
              @case ('danger') { <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M15 9l-6 6M9 9l6 6"/></svg> }
              @default { <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg> }
            }
          </div>
          <div class="min-w-0 flex-1">
            <div class="text-sm font-medium text-fg-strong">{{ t.title }}</div>
            @if (t.description) { <div class="text-xs text-fg-muted mt-0.5">{{ t.description }}</div> }
          </div>
          <button (click)="toastService.dismiss(t.id)" class="text-fg-faint hover:text-fg-strong shrink-0" aria-label="Dismiss">
            <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </button>
        </div>
      }
    </div>
  `,
})
export class ToastHostComponent {
  toastService = inject(ToastService);

  kindColor(kind: 'info' | 'success' | 'warning' | 'danger'): string {
    switch (kind) {
      case 'success': return 'var(--success)';
      case 'warning': return 'var(--warning)';
      case 'danger': return 'var(--danger)';
      default: return 'var(--info)';
    }
  }
}
