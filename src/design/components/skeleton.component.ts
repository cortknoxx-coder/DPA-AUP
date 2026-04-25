import { Component, input } from '@angular/core';

@Component({
  selector: 'dpa-skeleton',
  standalone: true,
  template: `
    <div class="skeleton" [style.width]="width()" [style.height]="height()" [style.borderRadius]="radius()"></div>
  `,
})
export class SkeletonComponent {
  width = input<string>('100%');
  height = input<string>('1rem');
  radius = input<string>('var(--radius-md)');
}
