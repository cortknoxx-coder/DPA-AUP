import { Injectable, signal } from '@angular/core';
import { DcnpEventType } from '../types';

export interface NotificationStep {
  cssClass: string;
  durationMs: number;
  repeatCount: number;
  customDuration?: string; // CSS animation-duration override
}

export interface NotificationPattern {
  steps: NotificationStep[];
}

@Injectable({ providedIn: 'root' })
export class LedNotificationService {

  activeNotification = signal<{ type: DcnpEventType; color: string } | null>(null);

  private abortController: AbortController | null = null;

  private readonly PATTERNS: Record<DcnpEventType, NotificationPattern> = {
    concert: {
      // Rapid pulse 3x then breathing 30s
      steps: [
        { cssClass: 'animate-flash', durationMs: 600, repeatCount: 3 },
        { cssClass: 'animate-breathe', durationMs: 4000, repeatCount: 2 }
      ]
    },
    video: {
      // Slow fade in, hold, fade out — repeat 2x
      steps: [
        { cssClass: 'animate-fade-glow', durationMs: 7000, repeatCount: 2 }
      ]
    },
    merch: {
      // 3 quick flashes then solid 10s
      steps: [
        { cssClass: 'animate-flash', durationMs: 400, repeatCount: 3 },
        { cssClass: 'led-solid', durationMs: 3000, repeatCount: 1 }
      ]
    },
    remix: {
      // Rhythmic pulse at 120bpm for ~5s
      steps: [
        { cssClass: 'animate-rhythmic-pulse', durationMs: 5000, repeatCount: 1, customDuration: '500ms' }
      ]
    },
    signing: {
      // Slow breathing for ~8s
      steps: [
        { cssClass: 'animate-breathe', durationMs: 8000, repeatCount: 1 }
      ]
    },
    other: {
      // 2 gentle flashes
      steps: [
        { cssClass: 'animate-flash', durationMs: 600, repeatCount: 2 }
      ]
    }
  };

  getPattern(type: DcnpEventType): NotificationPattern {
    return this.PATTERNS[type];
  }

  /**
   * Play a notification animation sequence.
   * The applyStyle callback receives the CSS class, color, and optional custom duration
   * to apply to the glow element. clearStyle is called when the sequence finishes.
   */
  async playNotification(
    type: DcnpEventType,
    color: string,
    applyStyle: (cssClass: string, color: string, customDuration?: string) => void,
    clearStyle: () => void
  ): Promise<void> {
    // Cancel any running notification
    if (this.abortController) {
      this.abortController.abort();
    }
    this.abortController = new AbortController();
    const signal = this.abortController.signal;

    this.activeNotification.set({ type, color });
    const pattern = this.PATTERNS[type];

    try {
      for (const step of pattern.steps) {
        for (let r = 0; r < step.repeatCount; r++) {
          if (signal.aborted) return;
          applyStyle(step.cssClass, color, step.customDuration);
          await this.delay(step.durationMs, signal);
        }
      }
    } catch {
      // Aborted
    } finally {
      clearStyle();
      this.activeNotification.set(null);
      if (this.abortController?.signal === signal) {
        this.abortController = null;
      }
    }
  }

  cancelNotification() {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }

  private delay(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(resolve, ms);
      signal?.addEventListener('abort', () => {
        clearTimeout(timer);
        reject(new DOMException('Aborted', 'AbortError'));
      }, { once: true });
    });
  }
}
