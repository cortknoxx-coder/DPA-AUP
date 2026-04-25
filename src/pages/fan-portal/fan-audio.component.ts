import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DeviceConnectionService } from '../../services/device-connection.service';
import { DeviceWifiService } from '../../services/device-wifi.service';
import { DeviceBleService, BLE_CMD } from '../../services/device-ble.service';
import { A2dpDevice, AudioWidthMode, EqPreset, PlaybackMode } from '../../types';

@Component({
  selector: 'app-fan-audio',
  standalone: true,
  imports: [CommonModule],
  styles: [`
    :host {
      display: block;
      min-height: 100%;
      background:
        radial-gradient(circle at top, rgba(39, 39, 42, 0.9), transparent 38%),
        linear-gradient(180deg, #040404 0%, #0a0a0a 52%, #050505 100%);
      color: #fafafa;
    }

    .dsp-shell {
      width: min(1160px, 100%);
      margin: 0 auto;
      padding: 20px 18px 40px;
    }

    .dsp-card {
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 24px;
      background:
        linear-gradient(180deg, rgba(18, 18, 18, 0.94), rgba(10, 10, 10, 0.98));
      box-shadow:
        0 18px 60px rgba(0, 0, 0, 0.45),
        inset 0 1px 0 rgba(255, 255, 255, 0.05);
    }

    .dsp-panel {
      border: 1px solid rgba(255, 255, 255, 0.07);
      border-radius: 18px;
      background: linear-gradient(180deg, rgba(24, 24, 27, 0.96), rgba(12, 12, 14, 0.98));
      box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.03);
    }

    .dsp-label {
      font-size: 10px;
      letter-spacing: 0.28em;
      text-transform: uppercase;
      color: rgba(212, 212, 216, 0.65);
      font-weight: 700;
    }

    .dsp-heading {
      font-size: clamp(28px, 3vw, 44px);
      line-height: 0.95;
      letter-spacing: -0.04em;
      font-weight: 800;
      color: #f5f5f5;
    }

    .meter-surface {
      position: relative;
      overflow: hidden;
      min-height: 340px;
      padding: 18px 18px 12px;
      border-radius: 22px;
      background:
        linear-gradient(180deg, rgba(16, 16, 16, 0.96), rgba(6, 6, 6, 0.98)),
        linear-gradient(90deg, rgba(163, 163, 163, 0.08) 1px, transparent 1px),
        linear-gradient(0deg, rgba(163, 163, 163, 0.08) 1px, transparent 1px);
      background-size: auto, 11% 100%, 100% 16.66%;
      border: 1px solid rgba(255, 255, 255, 0.08);
      box-shadow:
        inset 0 0 0 1px rgba(255, 255, 255, 0.03),
        inset 0 -80px 120px rgba(0, 0, 0, 0.65);
    }

    .meter-rails {
      position: absolute;
      inset: 14px;
      display: flex;
      justify-content: space-between;
      pointer-events: none;
      font-size: 10px;
      letter-spacing: 0.22em;
      text-transform: uppercase;
      color: rgba(161, 161, 170, 0.42);
    }

    .meter-rail {
      display: grid;
      grid-template-rows: repeat(7, 1fr);
      align-items: stretch;
      gap: 0;
    }

    .meter-rail span {
      display: flex;
      align-items: center;
    }

    .curve-frame {
      position: relative;
      z-index: 1;
      width: 100%;
      height: 260px;
      margin-top: 26px;
    }

    .curve-status {
      position: relative;
      z-index: 1;
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 12px;
      margin-top: 10px;
    }

    .curve-stat {
      padding: 10px 12px;
      border-radius: 14px;
      background: rgba(255, 255, 255, 0.03);
      border: 1px solid rgba(255, 255, 255, 0.06);
    }

    .curve-stat strong {
      display: block;
      margin-top: 4px;
      color: #fafafa;
      font-size: 14px;
      font-weight: 700;
      letter-spacing: -0.01em;
    }

    .freq-row {
      display: grid;
      grid-template-columns: repeat(8, minmax(0, 1fr));
      gap: 8px;
      margin-top: 8px;
      color: rgba(212, 212, 216, 0.64);
      font-size: 10px;
      letter-spacing: 0.18em;
      text-transform: uppercase;
    }

    .control-grid {
      display: grid;
      grid-template-columns: 1.05fr 1.35fr;
      gap: 16px;
      margin-top: 18px;
    }

    .section-title {
      display: flex;
      align-items: center;
      gap: 10px;
      font-size: 12px;
      letter-spacing: 0.22em;
      text-transform: uppercase;
      color: rgba(228, 228, 231, 0.74);
      font-weight: 700;
    }

    .section-title svg {
      width: 16px;
      height: 16px;
      color: rgba(228, 228, 231, 0.84);
    }

    .knob-cluster {
      display: grid;
      grid-template-columns: auto 1fr auto;
      gap: 16px;
      align-items: center;
      margin-top: 18px;
    }

    .trim-button {
      width: 52px;
      height: 52px;
      border-radius: 999px;
      border: 1px solid rgba(255, 255, 255, 0.1);
      background: linear-gradient(180deg, rgba(44, 44, 47, 0.98), rgba(17, 17, 19, 0.98));
      color: #f5f5f5;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      transition: transform 0.15s ease, border-color 0.15s ease, background 0.15s ease;
    }

    .trim-button:hover {
      transform: translateY(-1px);
      border-color: rgba(244, 244, 245, 0.24);
      background: linear-gradient(180deg, rgba(57, 57, 61, 0.98), rgba(22, 22, 24, 0.98));
    }

    .trim-button svg {
      width: 18px;
      height: 18px;
    }

    .level-strip {
      display: grid;
      gap: 10px;
    }

    .level-readout {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
    }

    .level-readout strong {
      font-size: 40px;
      line-height: 1;
      letter-spacing: -0.06em;
      color: #fafafa;
      font-weight: 800;
    }

    .level-readout span {
      font-size: 11px;
      letter-spacing: 0.22em;
      text-transform: uppercase;
      color: rgba(212, 212, 216, 0.62);
      font-weight: 700;
    }

    .volume-track {
      position: relative;
      height: 12px;
      border-radius: 999px;
      background: rgba(255, 255, 255, 0.06);
      overflow: hidden;
      box-shadow: inset 0 1px 4px rgba(0, 0, 0, 0.45);
    }

    .volume-fill {
      position: absolute;
      inset: 0 auto 0 0;
      border-radius: inherit;
      background: linear-gradient(90deg, #d6d3d1 0%, #f8fafc 45%, #e7b34e 100%);
      box-shadow: 0 0 24px rgba(231, 179, 78, 0.22);
    }

    .segment-grid,
    .preset-grid,
    .device-list {
      display: grid;
      gap: 10px;
      margin-top: 16px;
    }

    .preset-grid {
      grid-template-columns: repeat(5, minmax(0, 1fr));
    }

    .segment-grid.three {
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }

    .segment-grid.two {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .dsp-chip {
      position: relative;
      display: block;
      width: 100%;
      text-align: left;
      padding: 14px 14px 13px;
      border-radius: 16px;
      border: 1px solid rgba(255, 255, 255, 0.08);
      background: linear-gradient(180deg, rgba(26, 26, 28, 0.98), rgba(12, 12, 14, 0.98));
      transition: border-color 0.18s ease, transform 0.18s ease, box-shadow 0.18s ease, background 0.18s ease;
    }

    .dsp-chip:hover {
      transform: translateY(-1px);
      border-color: rgba(255, 255, 255, 0.18);
    }

    .dsp-chip.active {
      border-color: rgba(233, 179, 79, 0.74);
      background: linear-gradient(180deg, rgba(62, 46, 21, 0.95), rgba(22, 18, 12, 0.98));
      box-shadow:
        inset 0 0 0 1px rgba(255, 236, 196, 0.12),
        0 10px 30px rgba(231, 179, 78, 0.16);
    }

    .dsp-chip-title {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      color: #f8fafc;
      font-size: 14px;
      font-weight: 700;
      letter-spacing: -0.02em;
    }

    .dsp-chip-title svg {
      width: 16px;
      height: 16px;
      color: rgba(245, 245, 245, 0.82);
      flex-shrink: 0;
    }

    .dsp-chip-meta {
      margin-top: 6px;
      color: rgba(212, 212, 216, 0.6);
      font-size: 11px;
      letter-spacing: 0.16em;
      text-transform: uppercase;
      font-weight: 700;
    }

    .feature-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 16px;
      margin-top: 16px;
    }

    .telemetry-list {
      display: grid;
      gap: 12px;
      margin-top: 16px;
    }

    .telemetry-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      padding-bottom: 12px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.06);
    }

    .telemetry-row:last-child {
      padding-bottom: 0;
      border-bottom: 0;
    }

    .telemetry-row span {
      font-size: 11px;
      letter-spacing: 0.18em;
      text-transform: uppercase;
      color: rgba(212, 212, 216, 0.56);
      font-weight: 700;
    }

    .telemetry-row strong {
      color: #fafafa;
      font-size: 14px;
      font-weight: 700;
      letter-spacing: -0.01em;
    }

    .status-pill {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      border-radius: 999px;
      border: 1px solid rgba(255, 255, 255, 0.08);
      background: rgba(255, 255, 255, 0.03);
      padding: 8px 12px;
      font-size: 11px;
      letter-spacing: 0.18em;
      text-transform: uppercase;
      color: rgba(228, 228, 231, 0.72);
      font-weight: 700;
    }

    .status-dot {
      width: 8px;
      height: 8px;
      border-radius: 999px;
      background: #71717a;
      box-shadow: 0 0 12px rgba(113, 113, 122, 0.4);
    }

    .status-dot.live {
      background: #f1c75a;
      box-shadow: 0 0 14px rgba(241, 199, 90, 0.45);
    }

    .device-list button {
      text-align: left;
      padding: 14px;
      border-radius: 16px;
      border: 1px solid rgba(255, 255, 255, 0.08);
      background: linear-gradient(180deg, rgba(26, 26, 28, 0.98), rgba(12, 12, 14, 0.98));
      transition: border-color 0.16s ease, transform 0.16s ease;
    }

    .device-list button:hover {
      transform: translateY(-1px);
      border-color: rgba(244, 244, 245, 0.2);
    }

    .icon-button,
    .primary-button,
    .secondary-button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 10px;
      border-radius: 14px;
      border: 1px solid rgba(255, 255, 255, 0.08);
      font-size: 12px;
      letter-spacing: 0.18em;
      text-transform: uppercase;
      font-weight: 700;
      transition: transform 0.16s ease, border-color 0.16s ease, background 0.16s ease;
    }

    .primary-button {
      padding: 14px 16px;
      background: linear-gradient(180deg, rgba(232, 183, 84, 0.98), rgba(173, 123, 33, 0.98));
      color: #0a0a0a;
      border-color: rgba(255, 225, 163, 0.32);
    }

    .secondary-button,
    .icon-button {
      padding: 14px 16px;
      background: linear-gradient(180deg, rgba(24, 24, 27, 0.98), rgba(10, 10, 12, 0.98));
      color: #f5f5f5;
    }

    .primary-button:hover,
    .secondary-button:hover,
    .icon-button:hover {
      transform: translateY(-1px);
    }

    .primary-button svg,
    .secondary-button svg,
    .icon-button svg,
    .section-title svg,
    .status-pill svg {
      width: 16px;
      height: 16px;
    }

    .empty-state {
      padding: 24px;
      text-align: center;
      color: rgba(212, 212, 216, 0.72);
    }

    .empty-state svg {
      width: 36px;
      height: 36px;
      margin: 0 auto 14px;
      color: rgba(212, 212, 216, 0.58);
    }

    @media (max-width: 980px) {
      .control-grid {
        grid-template-columns: 1fr;
      }

      .preset-grid {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }

      .curve-status,
      .feature-grid {
        grid-template-columns: 1fr;
      }
    }

    @media (max-width: 640px) {
      .dsp-shell {
        padding-inline: 12px;
      }

      .meter-surface {
        min-height: 300px;
        padding-inline: 12px;
      }

      .curve-frame {
        height: 220px;
      }

      .freq-row {
        grid-template-columns: repeat(4, minmax(0, 1fr));
        row-gap: 6px;
      }

      .preset-grid,
      .segment-grid.three,
      .segment-grid.two {
        grid-template-columns: 1fr;
      }

      .knob-cluster {
        grid-template-columns: auto 1fr auto;
        gap: 12px;
      }
    }
  `],
  template: `
    <div class="dsp-shell">
      @if (connectionService.connectionStatus() === 'disconnected') {
        <div class="dsp-card empty-state">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7">
            <path d="M12 2v8"></path>
            <path d="M8.2 5.8A7 7 0 1 0 19 12"></path>
          </svg>
          <div class="dsp-label">Device DSP</div>
          <div class="mt-2 text-2xl font-bold tracking-tight text-zinc-50">Connect your DPA</div>
          <p class="mt-3 text-sm text-zinc-400">Join over WiFi or Bluetooth to unlock the live DSP surface.</p>
        </div>
      } @else {
        <div class="dsp-card p-4 md:p-5">
          <div class="flex flex-col gap-4">
            <div class="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
              <div>
                <div class="dsp-label">Device DSP</div>
                <h1 class="dsp-heading mt-2">Reference EQ</h1>
                <p class="mt-3 max-w-2xl text-sm text-zinc-400">
                  Graph-first contour control for the live DPA device. Presets, stereo image, transport, and output stay tied to firmware state.
                </p>
              </div>
              <div class="status-pill">
                <span class="status-dot" [class.live]="audio()?.hasLiveStatus"></span>
                <span>{{ audio()?.hasLiveStatus ? 'Live Device State' : 'Cached Device State' }}</span>
              </div>
            </div>

            <div class="meter-surface">
              <div class="meter-rails">
                <div class="meter-rail">
                  <span>+12</span>
                  <span>+8</span>
                  <span>+4</span>
                  <span>0</span>
                  <span>-4</span>
                  <span>-8</span>
                  <span>-12</span>
                </div>
                <div class="meter-rail text-right">
                  <span>+12</span>
                  <span>+8</span>
                  <span>+4</span>
                  <span>0</span>
                  <span>-4</span>
                  <span>-8</span>
                  <span>-12</span>
                </div>
              </div>

              <div class="curve-frame">
                <svg viewBox="0 0 1000 340" preserveAspectRatio="none" class="h-full w-full">
                  <defs>
                    <linearGradient id="curveGlow" x1="0%" y1="0%" x2="100%" y2="0%">
                      <stop offset="0%" stop-color="#f8fafc" stop-opacity="0.9"></stop>
                      <stop offset="65%" stop-color="#f1c75a" stop-opacity="0.96"></stop>
                      <stop offset="100%" stop-color="#d6a43c" stop-opacity="0.9"></stop>
                    </linearGradient>
                    <linearGradient id="curveFill" x1="0%" y1="0%" x2="0%" y2="100%">
                      <stop offset="0%" stop-color="#f1c75a" stop-opacity="0.28"></stop>
                      <stop offset="100%" stop-color="#f1c75a" stop-opacity="0"></stop>
                    </linearGradient>
                  </defs>
                  <path d="M0 170 H1000" stroke="rgba(255,255,255,0.18)" stroke-width="1.2"></path>
                  <path [attr.d]="eqFillPath()" fill="url(#curveFill)"></path>
                  <path [attr.d]="eqCurvePath()" stroke="url(#curveGlow)" stroke-width="5.5" stroke-linecap="round" stroke-linejoin="round" fill="none" filter="url(#none)"></path>
                  <path [attr.d]="eqCurvePath()" stroke="rgba(255,255,255,0.35)" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" fill="none"></path>

                  @for (node of eqNodes(); track node.label) {
                    <g [attr.transform]="'translate(' + node.x + ' ' + node.y + ')'">
                      <circle r="16" fill="#0b0b0c" stroke="rgba(255,255,255,0.22)" stroke-width="1.4"></circle>
                      <circle r="7" fill="#f1c75a"></circle>
                      <text y="34" text-anchor="middle" fill="rgba(228,228,231,0.72)" style="font-size: 11px; letter-spacing: 0.18em; text-transform: uppercase;">
                        {{ node.label }}
                      </text>
                    </g>
                  }
                </svg>
              </div>

              <div class="freq-row">
                @for (label of frequencyLabels; track label) {
                  <span>{{ label }}</span>
                }
              </div>

              <div class="curve-status">
                <div class="curve-stat">
                  <div class="dsp-label">Profile</div>
                  <strong>{{ currentPresetMeta().label }}</strong>
                </div>
                <div class="curve-stat">
                  <div class="dsp-label">Stereo</div>
                  <strong>{{ currentWidth() === 'enhanced' ? 'Enhanced Image' : 'Focused Image' }}</strong>
                </div>
                <div class="curve-stat">
                  <div class="dsp-label">Transport</div>
                  <strong>{{ currentMode() === 'repeat_one' ? 'Repeat One' : 'Linear Play' }}</strong>
                </div>
              </div>
            </div>

            <div class="control-grid">
              <div class="dsp-panel p-5">
                <div class="section-title">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7">
                    <path d="M12 3v18"></path>
                    <path d="M5 8h4"></path>
                    <path d="M15 16h4"></path>
                  </svg>
                  <span>Output Trim</span>
                </div>

                <div class="knob-cluster">
                  <button class="trim-button" (click)="volumeDown()" aria-label="Lower volume">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9">
                      <path d="M6 12h12"></path>
                    </svg>
                  </button>

                  <div class="level-strip">
                    <div class="level-readout">
                      <strong>{{ currentVolume() }}</strong>
                      <span>Master</span>
                    </div>
                    <div class="volume-track">
                      <div class="volume-fill" [style.width.%]="currentVolume()"></div>
                    </div>
                    <div class="flex items-center justify-between text-[11px] uppercase tracking-[0.22em] text-zinc-500">
                      <span>Soft clip reserve</span>
                      <span>{{ currentVolume() > 90 ? 'Near ceiling' : 'Headroom intact' }}</span>
                    </div>
                  </div>

                  <button class="trim-button" (click)="volumeUp()" aria-label="Raise volume">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9">
                      <path d="M12 6v12"></path>
                      <path d="M6 12h12"></path>
                    </svg>
                  </button>
                </div>

                <div class="telemetry-list">
                  <div class="telemetry-row">
                    <span>Current contour</span>
                    <strong>{{ currentPresetMeta().tagline }}</strong>
                  </div>
                  <div class="telemetry-row">
                    <span>Low band</span>
                    <strong>{{ currentPresetMeta().bandSummary.low }}</strong>
                  </div>
                  <div class="telemetry-row">
                    <span>Presence band</span>
                    <strong>{{ currentPresetMeta().bandSummary.mid }}</strong>
                  </div>
                  <div class="telemetry-row">
                    <span>Air band</span>
                    <strong>{{ currentPresetMeta().bandSummary.high }}</strong>
                  </div>
                </div>
              </div>

              <div class="grid gap-4">
                <div class="dsp-panel p-5">
                  <div class="section-title">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7">
                      <path d="M4 19V5"></path>
                      <path d="M10 19V8"></path>
                      <path d="M16 19V10"></path>
                      <path d="M22 19V4"></path>
                    </svg>
                    <span>Sound Profile</span>
                  </div>

                  <div class="preset-grid">
                    @for (preset of eqPresets; track preset.id) {
                      <button
                        (click)="setEq(preset.id)"
                        class="dsp-chip"
                        [class.active]="currentEq() === preset.id"
                        [attr.aria-pressed]="currentEq() === preset.id">
                        <div class="dsp-chip-title">
                          <span>{{ preset.label }}</span>
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
                            <path [attr.d]="preset.iconPath"></path>
                          </svg>
                        </div>
                        <div class="dsp-chip-meta">{{ preset.meta }}</div>
                      </button>
                    }
                  </div>
                </div>

                <div class="feature-grid">
                  <div class="dsp-panel p-5">
                    <div class="section-title">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7">
                        <path d="M4 7h7"></path>
                        <path d="M13 17h7"></path>
                        <path d="M7 4v6"></path>
                        <path d="M17 14v6"></path>
                      </svg>
                      <span>Stereo Image</span>
                    </div>

                    <div class="segment-grid two">
                      @for (mode of widthModes; track mode.id) {
                        <button
                          (click)="setStereoWidth(mode.id)"
                          class="dsp-chip"
                          [class.active]="currentWidth() === mode.id">
                          <div class="dsp-chip-title">
                            <span>{{ mode.label }}</span>
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
                              <path [attr.d]="mode.iconPath"></path>
                            </svg>
                          </div>
                          <div class="dsp-chip-meta">{{ mode.meta }}</div>
                        </button>
                      }
                    </div>
                  </div>

                  <div class="dsp-panel p-5">
                    <div class="section-title">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7">
                        <path d="M6 5v14"></path>
                        <path d="M10 8l8 4-8 4V8Z"></path>
                      </svg>
                      <span>Playback Mode</span>
                    </div>

                    <div class="segment-grid two">
                      @for (mode of playbackModes; track mode.id) {
                        <button
                          (click)="setMode(mode.id)"
                          class="dsp-chip"
                          [class.active]="currentMode() === mode.id">
                          <div class="dsp-chip-title">
                            <span>{{ mode.label }}</span>
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
                              <path [attr.d]="mode.iconPath"></path>
                            </svg>
                          </div>
                          <div class="dsp-chip-meta">{{ mode.meta }}</div>
                        </button>
                      }
                    </div>
                  </div>
                </div>

                <div class="feature-grid">
                  <div class="dsp-panel p-5">
                    <div class="section-title">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7">
                        <path d="M7 17a4 4 0 0 1 0-8"></path>
                        <path d="M12 19V5l6 4v6l-6 4Z"></path>
                        <path d="M5 12H4"></path>
                      </svg>
                      <span>Bluetooth Output</span>
                    </div>

                    <div class="telemetry-list">
                      <div class="telemetry-row">
                        <span>Status</span>
                        <strong>{{ a2dpStatusLabel() }}</strong>
                      </div>
                      <div class="telemetry-row">
                        <span>Target</span>
                        <strong>{{ a2dpDeviceName() || 'No routed device' }}</strong>
                      </div>
                    </div>

                    <div class="mt-4 flex flex-wrap gap-3">
                      <button class="secondary-button" (click)="scanA2dp()" [disabled]="scanning()">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7">
                          <path d="M11 4a7 7 0 1 0 7 7"></path>
                          <path d="M20 4v6h-6"></path>
                        </svg>
                        <span>{{ scanning() ? 'Scanning' : 'Scan Devices' }}</span>
                      </button>

                      @if (a2dpConnected()) {
                        <button class="icon-button" (click)="disconnectA2dp()">
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7">
                            <path d="M8 8l8 8"></path>
                            <path d="M16 8l-8 8"></path>
                          </svg>
                          <span>Disconnect</span>
                        </button>
                      }
                    </div>

                    @if (discoveredDevices().length > 0) {
                      <div class="device-list mt-4">
                        @for (device of discoveredDevices(); track device.addr) {
                          <button (click)="connectA2dp(device.addr)" [disabled]="connecting()">
                            <div class="dsp-chip-title">
                              <span>{{ device.name || 'Unnamed Device' }}</span>
                              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
                                <path d="M7 7l10 10"></path>
                                <path d="M7 17l10-10"></path>
                              </svg>
                            </div>
                            <div class="dsp-chip-meta">{{ device.addr }} • {{ device.rssi }} dBm</div>
                          </button>
                        }
                      </div>
                    }
                  </div>

                  <div class="dsp-panel p-5">
                    <div class="section-title">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7">
                        <path d="M6 9V7a6 6 0 1 1 12 0v2"></path>
                        <path d="M4 9h16v8a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3V9Z"></path>
                      </svg>
                      <span>Device Telemetry</span>
                    </div>

                    <div class="telemetry-list">
                      <div class="telemetry-row">
                        <span>Battery</span>
                        <strong>{{ batteryLabel() }}</strong>
                      </div>
                      <div class="telemetry-row">
                        <span>Storage used</span>
                        <strong>{{ storageInfo()?.usedMB ?? 0 }} / {{ storageInfo()?.totalMB ?? 0 }} MB</strong>
                      </div>
                      <div class="telemetry-row">
                        <span>Track load</span>
                        <strong>{{ storageInfo()?.trackCount ?? 0 }} DPA tracks</strong>
                      </div>
                      <div class="telemetry-row">
                        <span>Capsules</span>
                        <strong>{{ storageInfo()?.capsuleCount ?? 0 }}</strong>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      }
    </div>
  `,
})
export class FanAudioComponent {
  connectionService = inject(DeviceConnectionService);
  private wifiService = inject(DeviceWifiService);
  private bleService = inject(DeviceBleService);

  scanning = signal(false);
  connecting = signal(false);
  discoveredDevices = signal<A2dpDevice[]>([]);

  eqPresets = [
    {
      id: 'flat' as EqPreset,
      label: 'Flat',
      meta: 'Reference',
      iconPath: 'M4 12h16',
      bandSummary: { low: 'Neutral', mid: 'Linear', high: 'Uncolored' },
      tagline: 'Zero contour',
    },
    {
      id: 'dpa_signature' as EqPreset,
      label: 'DPA Signature',
      meta: 'House curve',
      iconPath: 'M4 14c3-3 5-4 8-4s5 1 8 4',
      bandSummary: { low: 'Lifted', mid: 'Clean', high: 'Polished' },
      tagline: 'Premium contour',
    },
    {
      id: 'hip_hop' as EqPreset,
      label: 'Hip-Hop',
      meta: 'Low-end drive',
      iconPath: 'M4 16c2-5 5-7 8-7 4 0 6 2 8 7',
      bandSummary: { low: 'Heavy', mid: 'Scooped', high: 'Controlled' },
      tagline: 'Bass-forward',
    },
    {
      id: 'pop' as EqPreset,
      label: 'Pop',
      meta: 'Forward vocals',
      iconPath: 'M4 14c2-1 4-2 6-2 4 0 6 2 10 2',
      bandSummary: { low: 'Tight', mid: 'Forward', high: 'Bright' },
      tagline: 'Modern gloss',
    },
    {
      id: 'vocal' as EqPreset,
      label: 'Vocal',
      meta: 'Presence focus',
      iconPath: 'M4 12c4 0 6-4 8-4s4 4 8 4',
      bandSummary: { low: 'Trimmed', mid: 'Present', high: 'Airy' },
      tagline: 'Center image',
    },
  ];

  widthModes = [
    {
      id: 'off' as AudioWidthMode,
      label: 'Stereo Off',
      meta: 'Focused center',
      iconPath: 'M8 8v8M16 8v8',
    },
    {
      id: 'enhanced' as AudioWidthMode,
      label: 'Stereo Enhanced',
      meta: 'Expanded image',
      iconPath: 'M5 12h14M8 8l-4 4 4 4M16 8l4 4-4 4',
    },
  ];

  playbackModes = [
    {
      id: 'normal' as PlaybackMode,
      label: 'Normal',
      meta: 'Linear queue',
      iconPath: 'M7 6v12l10-6-10-6Z',
    },
    {
      id: 'repeat_one' as PlaybackMode,
      label: 'Repeat One',
      meta: 'Loop current',
      iconPath: 'M7 7h8l-2-2m2 12H9l2 2M17 8v8',
    },
  ];

  readonly frequencyLabels = ['32', '63', '125', '250', '1K', '2K', '4K', '16K'];

  private audio = computed(() => this.connectionService.deviceAudio());

  currentVolume = computed(() => this.audio()?.volume ?? 75);
  currentEq = computed(() => this.audio()?.eq ?? 'flat');
  currentWidth = computed(() => this.audio()?.width ?? 'off');
  currentMode = computed(() => this.audio()?.mode ?? 'normal');
  a2dpConnected = computed(() => {
    const s = this.audio()?.a2dp;
    return s === 'connected' || s === 'playing';
  });
  a2dpDeviceName = computed(() => this.audio()?.a2dpDevice ?? '');
  a2dpStatusLabel = computed(() => {
    const s = this.audio()?.a2dp ?? 'disconnected';
    switch (s) {
      case 'connected': return 'Connected';
      case 'playing': return 'Streaming';
      case 'connecting': return 'Connecting';
      default: return 'Not Connected';
    }
  });

  batteryInfo = computed(() => this.connectionService.deviceBattery());
  storageInfo = computed(() => this.connectionService.deviceStorage());
  currentPresetMeta = computed(
    () => this.eqPresets.find((preset) => preset.id === this.currentEq()) ?? this.eqPresets[0]
  );
  eqCurvePath = computed(() => {
    switch (this.currentEq()) {
      case 'dpa_signature':
        return 'M0 196 C72 182 138 134 220 146 C304 160 362 190 434 182 C520 172 582 136 650 126 C728 116 806 124 886 138 C930 146 968 154 1000 160';
      case 'hip_hop':
        return 'M0 214 C76 154 148 110 238 122 C318 136 372 178 454 188 C540 196 606 182 676 168 C764 150 848 138 930 148 C962 152 986 158 1000 162';
      case 'pop':
        return 'M0 188 C84 176 148 170 226 176 C304 184 356 182 432 168 C518 152 586 138 662 144 C748 150 832 130 918 124 C956 122 984 124 1000 128';
      case 'vocal':
        return 'M0 200 C78 198 148 192 234 190 C316 188 384 166 454 148 C520 132 590 130 664 138 C748 148 822 152 906 154 C952 156 982 158 1000 160';
      default:
        return 'M0 170 C110 170 220 170 332 170 C444 170 556 170 668 170 C780 170 890 170 1000 170';
    }
  });
  eqFillPath = computed(() => `${this.eqCurvePath()} L1000 340 L0 340 Z`);
  eqNodes = computed(() => {
    const preset = this.currentEq();
    if (preset === 'hip_hop') {
      return [
        { x: 170, y: 126, label: 'Lo' },
        { x: 495, y: 191, label: 'Mid' },
        { x: 832, y: 143, label: 'Hi' },
      ];
    }
    if (preset === 'pop') {
      return [
        { x: 182, y: 176, label: 'Lo' },
        { x: 520, y: 150, label: 'Mid' },
        { x: 864, y: 128, label: 'Hi' },
      ];
    }
    if (preset === 'vocal') {
      return [
        { x: 188, y: 190, label: 'Lo' },
        { x: 514, y: 132, label: 'Mid' },
        { x: 842, y: 151, label: 'Hi' },
      ];
    }
    if (preset === 'dpa_signature') {
      return [
        { x: 168, y: 147, label: 'Lo' },
        { x: 518, y: 174, label: 'Mid' },
        { x: 842, y: 134, label: 'Hi' },
      ];
    }
    return [
      { x: 190, y: 170, label: 'Lo' },
      { x: 520, y: 170, label: 'Mid' },
      { x: 846, y: 170, label: 'Hi' },
    ];
  });

  batteryLabel(): string {
    const battery = this.batteryInfo();
    if (!battery) return 'Unavailable';
    if (battery.present === false) return 'USB Powered';
    const suffix = battery.charging ? ' • Charging' : '';
    return `${Math.max(0, battery.percent)}% • ${battery.voltage.toFixed(2)}V${suffix}`;
  }

  async volumeUp() {
    const newVol = Math.min(100, this.currentVolume() + 5);
    if (this.connectionService.connectionStatus() === 'wifi') {
      await this.wifiService.setVolume(newVol);
    } else {
      await this.bleService.sendCommand(BLE_CMD.VOLUME_UP);
    }
    await this.refreshStatus();
  }

  async volumeDown() {
    const newVol = Math.max(0, this.currentVolume() - 5);
    if (this.connectionService.connectionStatus() === 'wifi') {
      await this.wifiService.setVolume(newVol);
    } else {
      await this.bleService.sendCommand(BLE_CMD.VOLUME_DOWN);
    }
    await this.refreshStatus();
  }

  async setEq(preset: EqPreset) {
    if (this.connectionService.connectionStatus() === 'wifi') {
      await this.wifiService.setEqPreset(preset);
    } else {
      await this.bleService.sendCommand(BLE_CMD.CYCLE_EQ);
    }
    await this.refreshStatus();
  }

  async setStereoWidth(mode: AudioWidthMode) {
    if (this.connectionService.connectionStatus() === 'wifi') {
      await this.wifiService.setStereoWidth(mode);
      await this.refreshStatus();
    }
  }

  async setMode(mode: PlaybackMode) {
    if (this.connectionService.connectionStatus() === 'wifi') {
      await this.wifiService.setPlaybackMode(mode);
    } else {
      await this.bleService.sendCommand(BLE_CMD.CYCLE_MODE);
    }
    await this.refreshStatus();
  }

  async scanA2dp() {
    this.scanning.set(true);
    this.discoveredDevices.set([]);
    try {
      if (this.connectionService.connectionStatus() === 'wifi') {
        const devices = await this.wifiService.scanA2dpDevices();
        this.discoveredDevices.set(devices);
      } else {
        await this.bleService.sendCommand(BLE_CMD.A2DP_SCAN);
        await new Promise((resolve) => setTimeout(resolve, 5000));
        const devices = await this.wifiService.getA2dpDevices();
        this.discoveredDevices.set(devices);
      }
    } finally {
      this.scanning.set(false);
    }
  }

  async connectA2dp(addr: string) {
    this.connecting.set(true);
    try {
      await this.wifiService.connectA2dp(addr);
      await this.refreshStatus();
    } finally {
      this.connecting.set(false);
    }
  }

  async disconnectA2dp() {
    await this.wifiService.disconnectA2dp();
    await this.refreshStatus();
  }

  private async refreshStatus() {
    try {
      await this.wifiService.getStatus();
    } catch {
      // ignore
    }
  }
}
