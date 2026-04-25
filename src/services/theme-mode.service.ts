import { DestroyRef, Injectable, inject, signal } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { filter } from 'rxjs/operators';
import { setMode, type DesignMode } from '../design/tokens';

/**
 * Watches the active route and toggles the global data-mode attribute used
 * by the design tokens (CSS custom properties) to pick between the two
 * aesthetic modes:
 *   - streaming  →  fan portal (Modern Streaming language, album-tinted)
 *   - studio     →  creator + admin (Studio Pro language, cyan accent)
 */
@Injectable({ providedIn: 'root' })
export class ThemeModeService {
  private router = inject(Router);
  private destroyRef = inject(DestroyRef);
  readonly mode = signal<DesignMode>('studio');

  constructor() {
    setMode('studio');
    const sub = this.router.events
      .pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd))
      .subscribe((e) => {
        const next: DesignMode = e.urlAfterRedirects.startsWith('/fan') ? 'streaming' : 'studio';
        if (next !== this.mode()) {
          this.mode.set(next);
          setMode(next);
        }
      });
    this.destroyRef.onDestroy(() => sub.unsubscribe());
  }
}
