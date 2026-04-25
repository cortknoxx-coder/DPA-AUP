import { Component, input } from '@angular/core';

/** Inline-importable empty-state surface that matches token language. */
@Component({
  selector: 'dpa-empty-state',
  standalone: true,
  template: `
    <div class="empty-state anim-fade">
      @if (icon()) {
        <div class="empty-state-icon">
          <span [innerHTML]="icon()"></span>
        </div>
      }
      <div class="empty-state-title">{{ title() }}</div>
      @if (description()) {
        <p class="text-sm text-fg-muted max-w-sm">{{ description() }}</p>
      }
      <ng-content></ng-content>
    </div>
  `,
})
export class EmptyStateComponent {
  title = input.required<string>();
  description = input<string>('');
  icon = input<string>('');
}
