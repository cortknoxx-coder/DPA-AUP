
import { Component, input, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { LedPattern } from '../../types';
import { BrandMarkComponent } from '../brand-mark/brand-mark.component';

@Component({
  selector: 'app-device-preview',
  standalone: true,
  imports: [CommonModule, BrandMarkComponent],
  templateUrl: './device-preview.component.html',
})
export class DevicePreviewComponent {
  ledColor = input<string>('#00ff88');
  ledPattern = input<LedPattern>('breathing');
  skinImage = input<string | undefined>();
  skinType = input<'partial' | 'full'>('partial');
  glowOverride = input<{ cssClass: string; color: string; customDuration?: string } | null>(null);

  // Map all firmware patterns to a CSS animation class for the glow preview
  glowClass = computed(() => {
    const p = this.ledPattern();
    if (p === 'off') return 'off';
    if (p === 'solid') return 'solid';
    if (p === 'breathing' || p.startsWith('vu_') || p === 'audio_vu') return 'breathing';
    if (p === 'pulse' || p === 'audio_pulse' || p === 'audio_bass' || p === 'audio_beat') return 'pulse';
    // Animated patterns: use a fast comet-style pulse
    return 'animated';
  });
}
