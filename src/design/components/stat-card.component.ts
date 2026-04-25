import { Component, computed, input } from '@angular/core';

@Component({
  selector: 'dpa-stat',
  standalone: true,
  template: `
    <div class="stat">
      <div class="stat-label">{{ label() }}</div>
      <div class="stat-value">{{ value() }}</div>
      @if (delta()) {
        <div class="stat-delta" [class.stat-delta-up]="trend() === 'up'" [class.stat-delta-down]="trend() === 'down'">{{ delta() }}</div>
      }
    </div>
  `,
})
export class StatCardComponent {
  label = input.required<string>();
  value = input.required<string | number>();
  delta = input<string>('');
  trend = input<'up' | 'down' | 'neutral'>('neutral');
}
