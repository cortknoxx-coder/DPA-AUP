
import { Component, inject, signal, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { DeviceConnectionService } from '../../services/device-connection.service';
import { UserService } from '../../services/user.service';
import { DevicePreviewComponent } from '../../components/device-preview/device-preview.component';
import { Theme, LedPattern, DeviceTrack, FirmwareStatus } from '../../types';

type ViewState = 'dashboard' | 'unregister-auth' | 'unregister-confirm';
type LedMode = 'idle' | 'playback' | 'charging';
type LedPatternOption = { value: LedPattern; label: string };
type LedPatternGroup = { label: string; options: LedPatternOption[] };

@Component({
  selector: 'app-fan-device-registration',
  standalone: true,
  imports: [CommonModule, FormsModule, ReactiveFormsModule, DevicePreviewComponent],
  templateUrl: './fan-device-registration.component.html'
})
export class FanDeviceRegistrationComponent {
  deviceService = inject(DeviceConnectionService);
  userService = inject(UserService);
  private fb = inject(FormBuilder);

  // View State
  viewState = signal<ViewState>('dashboard');

  // Registration Form
  deviceIdInput = signal('');
  errorMsg = signal('');
  analysisStep = signal<string>('');

  // Unregister Flow Form
  authEmail = signal('');
  authError = signal('');
  isProcessingAuth = signal(false);

  confirmDeviceIdInput = signal('');
  confirmError = signal('');

  // LED Controls
  ledPreviewMode = signal<LedMode>('idle');
  isPushingTheme = signal(false);
  pushStatus = signal<'idle' | 'pushing' | 'ok' | 'error'>('idle');
  pushMessage = signal<string>('');
  deviceTracks = signal<DeviceTrack[]>([]);
  realTimeMode = signal(false);
  brightness = signal(80);
  gradEnd = signal('#ff6600');
  isSyncingLed = signal(false);
  private isHydratingFromFirmware = false;

  readonly ledModes: LedMode[] = ['idle', 'playback', 'charging'];
  readonly ledPatternGroups: LedPatternGroup[] = [
    {
      label: 'Basic',
      options: [
        { value: 'breathing', label: 'Breathing' },
        { value: 'solid', label: 'Solid' },
        { value: 'pulse', label: 'Pulse' },
        { value: 'off', label: 'Off' },
      ],
    },
    {
      label: 'Animated',
      options: [
        { value: 'rainbow', label: 'Rainbow' },
        { value: 'comet', label: 'Comet' },
        { value: 'wave', label: 'Wave' },
        { value: 'sparkle', label: 'Sparkle' },
        { value: 'fire', label: 'Fire' },
        { value: 'dual_comet', label: 'Dual Comet' },
        { value: 'meteor', label: 'Meteor Rain' },
        { value: 'theater', label: 'Theater Chase' },
        { value: 'bounce', label: 'Bounce' },
      ],
    },
    {
      label: 'Audio-Reactive',
      options: [
        { value: 'audio_pulse', label: 'Audio Pulse' },
        { value: 'audio_bass', label: 'Bass Flash' },
        { value: 'audio_beat', label: 'Beat Strobe' },
        { value: 'audio_comet', label: 'Audio Comet' },
        { value: 'audio_vu', label: 'Audio VU' },
      ],
    },
    {
      label: 'VU Meter',
      options: [
        { value: 'vu_classic', label: 'VU Classic' },
        { value: 'vu_fill', label: 'VU Fill' },
        { value: 'vu_peak', label: 'VU Peak Hold' },
        { value: 'vu_split', label: 'VU Stereo Split' },
        { value: 'vu_bass', label: 'VU Bass' },
        { value: 'vu_energy', label: 'VU Energy' },
      ],
    },
    {
      label: 'Notification',
      options: [
        { value: 'chase_fwd', label: 'Chase Forward' },
        { value: 'chase_rev', label: 'Chase Reverse' },
        { value: 'heartbeat', label: 'Heartbeat' },
        { value: 'fade_out', label: 'Fade Out' },
      ],
    },
  ];

  ledForm = this.fb.group({
    idle: this.fb.group({ color: ['#ff4bcb'], pattern: ['breathing'] }),
    playback: this.fb.group({ color: ['#00f1df'], pattern: ['vu_classic'] }),
    charging: this.fb.group({ color: ['#ffcc33'], pattern: ['breathing'] }),
  });

  dcnpForm = this.fb.group({
    concert: ['#ff3366'],
    video: ['#3366ff'],
    merch: ['#33ff99'],
    signing: ['#ffcc00'],
    remix: ['#cc33ff'],
    other: ['#ffffff'],
  });

  get currentLedColor(): string {
    const mode = this.ledPreviewMode();
    return (this.ledForm.value as any)[mode]?.color || '#00ff88';
  }

  get currentLedPattern(): LedPattern {
    const mode = this.ledPreviewMode();
    const fallback: LedPattern = mode === 'playback' ? 'vu_classic' : 'breathing';
    return this.asLedPattern((this.ledForm.value as any)[mode]?.pattern, fallback);
  }

  constructor() {
    // Real-time mode previews active LED settings via firmware endpoint.
    effect(() => {
      const rtm = this.realTimeMode();
      if (!rtm) return;

      const ledSub = this.ledForm.valueChanges.subscribe(() => {
        if (this.realTimeMode() && !this.isHydratingFromFirmware) {
          void this.previewCurrentModeOnDevice(true);
        }
      });

      const dcnpSub = this.dcnpForm.valueChanges.subscribe(() => {
        if (this.realTimeMode() && !this.isHydratingFromFirmware) {
          void this.pushThemeToDevice(true);
        }
      });

      return () => {
        ledSub.unsubscribe();
        dcnpSub.unsubscribe();
      };
    });

    effect(() => {
      if (this.deviceService.connectionStatus() === 'wifi') {
        void this.refreshDeviceTracks();
        void this.syncThemeFromFirmware(true);
      } else {
        this.deviceTracks.set([]);
      }
    }, { allowSignalWrites: true });
  }

  setLedPreviewMode(mode: LedMode) {
    this.ledPreviewMode.set(mode);
    if (this.realTimeMode()) {
      void this.previewCurrentModeOnDevice(true);
    }
  }

  onBrightnessChange(value: number | string) {
    const next = Number(value);
    if (Number.isNaN(next)) return;
    this.brightness.set(Math.max(0, Math.min(100, Math.round(next))));
    if (this.realTimeMode()) {
      void this.previewCurrentModeOnDevice(true);
    }
  }

  onGradEndChange(value: string) {
    this.gradEnd.set(value);
    if (this.realTimeMode()) {
      void this.previewCurrentModeOnDevice(true);
    }
  }

  async previewCurrentModeOnDevice(silent = false) {
    if (this.deviceService.connectionStatus() !== 'wifi') {
      if (!silent) {
        this.pushStatus.set('error');
        this.pushMessage.set('Connect to your DPA via WiFi to preview LED changes.');
      }
      return;
    }

    if (!silent) {
      this.pushStatus.set('pushing');
      this.pushMessage.set('Sending LED preview to device...');
    }

    const success = await this.deviceService.wifi.previewLed(this.ledPreviewMode(), {
      color: this.currentLedColor,
      pattern: this.currentLedPattern,
      brightness: this.brightness(),
      gradEnd: this.gradEnd(),
    });

    if (success) {
      if (!silent) {
        this.pushStatus.set('ok');
        this.pushMessage.set('Live LED preview updated on device.');
      }
    } else if (!silent) {
      this.pushStatus.set('error');
      this.pushMessage.set('Failed to send LED preview. Verify device WiFi and retry.');
    }
  }

  async syncThemeFromFirmware(silent = false) {
    if (this.deviceService.connectionStatus() !== 'wifi') return;

    this.isSyncingLed.set(true);
    if (!silent) {
      this.pushStatus.set('pushing');
      this.pushMessage.set('Syncing LED/theme state from device firmware...');
    }
    try {
      const status = await this.deviceService.wifi.getStatus();
      this.applyFirmwareState(status);
      if (!silent) {
        this.pushStatus.set('ok');
        this.pushMessage.set('Synced LED/theme controls from device firmware.');
      }
    } catch {
      if (!silent) {
        this.pushStatus.set('error');
        this.pushMessage.set('Failed to sync from firmware. Verify device WiFi and retry.');
      }
    } finally {
      this.isSyncingLed.set(false);
    }
  }

  async pushThemeToDevice(silent = false) {
    if (this.deviceService.connectionStatus() !== 'wifi') {
      if (!silent) {
        this.pushStatus.set('error');
        this.pushMessage.set('Connect to your DPA via WiFi to push theme changes.');
      }
      return;
    }

    this.isPushingTheme.set(true);
    this.pushStatus.set('pushing');
    if (!silent) this.pushMessage.set('Pushing theme to device...');

    const success = await this.deviceService.wifi.pushTheme(
      this.getThemeDraft(),
      this.brightness(),
      this.gradEnd()
    );

    this.isPushingTheme.set(false);

    if (success) {
      await this.syncThemeFromFirmware(true);
      this.pushStatus.set('ok');
      if (!silent) this.pushMessage.set('Theme pushed to device firmware.');
    } else {
      this.pushStatus.set('error');
      if (!silent) this.pushMessage.set('Failed to push theme. Verify device WiFi and retry.');
    }
  }

  private getThemeDraft(): Theme {
    const led = this.ledForm.value as Theme['led'];
    const dcnp = this.dcnpForm.value as Theme['dcnp'];
    return { led, dcnp } as Theme;
  }

  private asLedPattern(value: string | null | undefined, fallback: LedPattern): LedPattern {
    if (!value) return fallback;
    return value as LedPattern;
  }

  private applyFirmwareState(status: FirmwareStatus) {
    const led = status.led;
    const dcnp = status.dcnp;
    const formLed = this.ledForm.value as any;

    this.isHydratingFromFirmware = true;
    try {
      this.ledForm.patchValue({
        idle: {
          color: led?.idle?.color ?? formLed.idle?.color ?? '#ff4bcb',
          pattern: this.asLedPattern(led?.idle?.pattern, this.asLedPattern(formLed.idle?.pattern, 'breathing')),
        },
        playback: {
          color: led?.playback?.color ?? formLed.playback?.color ?? '#00f1df',
          pattern: this.asLedPattern(led?.playback?.pattern, this.asLedPattern(formLed.playback?.pattern, 'vu_classic')),
        },
        charging: {
          color: led?.charging?.color ?? formLed.charging?.color ?? '#ffcc33',
          pattern: this.asLedPattern(led?.charging?.pattern, this.asLedPattern(formLed.charging?.pattern, 'breathing')),
        },
      }, { emitEvent: false });

      this.dcnpForm.patchValue({
        concert: dcnp?.concert ?? this.dcnpForm.value.concert ?? '#ff3366',
        video: dcnp?.video ?? this.dcnpForm.value.video ?? '#3366ff',
        merch: dcnp?.merch ?? this.dcnpForm.value.merch ?? '#33ff99',
        signing: dcnp?.signing ?? this.dcnpForm.value.signing ?? '#ffcc00',
        remix: dcnp?.remix ?? this.dcnpForm.value.remix ?? '#cc33ff',
        other: dcnp?.other ?? this.dcnpForm.value.other ?? '#ffffff',
      }, { emitEvent: false });

      if (typeof led?.brightness === 'number') {
        this.brightness.set(Math.max(0, Math.min(100, Math.round(led.brightness))));
      }
      if (led?.gradEnd) {
        this.gradEnd.set(led.gradEnd);
      }
    } finally {
      this.isHydratingFromFirmware = false;
    }
  }

  // --- Registration Logic ---

  async register() {
    const id = this.deviceIdInput().trim();
    if (!id) return;

    this.errorMsg.set('');

    // Start Analysis Animation
    this.runAnalysisSequence();

    const success = await this.deviceService.registerDevice(id);

    if (!success) {
      this.errorMsg.set('Invalid Device ID. Please check the serial number on the back of your DPA unit. (Hint: Try DPA-1234)');
    } else {
      this.deviceIdInput.set('');
    }
  }

  private runAnalysisSequence() {
    const steps = [
      'Establishing Secure Handshake...',
      'Verifying Hardware Signature...',
      'Checking Distributed Ledger...',
      'Decrypting Master License Key...',
      'Finalizing Registration...'
    ];

    let i = 0;
    this.analysisStep.set(steps[0]);

    const interval = setInterval(() => {
      i++;
      if (i < steps.length && this.deviceService.registrationStatus() === 'analyzing') {
        this.analysisStep.set(steps[i]);
      } else {
        clearInterval(interval);
      }
    }, 600);
  }

  // --- Unregister Flow ---

  startUnregisterFlow() {
    // Pre-fill email if available from user profile for convenience
    this.authEmail.set(this.userService.userProfile().email || '');
    this.viewState.set('unregister-auth');
    this.authError.set('');
    this.confirmError.set('');
    this.confirmDeviceIdInput.set('');
  }

  cancelFlow() {
    this.viewState.set('dashboard');
    this.isProcessingAuth.set(false);
  }

  async verifyIdentity() {
    if (!this.authEmail()) {
      this.authError.set('Email is required.');
      return;
    }

    this.isProcessingAuth.set(true);
    this.authError.set('');

    const isValid = await this.deviceService.verifyEmail(this.authEmail());

    this.isProcessingAuth.set(false);

    if (isValid) {
      this.viewState.set('unregister-confirm');
    } else {
      this.authError.set('Verification failed. Please check your email address.');
    }
  }

  async sendIdReminder() {
    if (!this.authEmail()) return;

    this.isProcessingAuth.set(true); // Re-use spinner
    await this.deviceService.sendDeviceIdReminder(this.authEmail());
    this.isProcessingAuth.set(false);

    this.pushStatus.set('ok');
    this.pushMessage.set(`Device ID sent to ${this.authEmail()}. Check your inbox.`);
  }

  completeUnregister() {
    const inputId = this.confirmDeviceIdInput().trim().toUpperCase();
    const actualId = this.deviceService.registeredDeviceId();

    if (inputId !== actualId) {
      this.confirmError.set('Device ID does not match the currently registered device.');
      return;
    }

    // Success
    this.deviceService.unregisterDevice();
    this.viewState.set('dashboard'); // Will show registration form now
    this.pushStatus.set('ok');
    this.pushMessage.set('Device successfully unregistered. Reverting to Snippet Mode.');
  }

  // --- Lost Flow ---

  confirmLost() {
    const confirmMsg = "WARNING: Reporting your device as lost will immediately revoke its digital certificates. The device will revert to 'Snippet Mode' and cannot play encrypted content until verified by support.\n\nAre you sure?";
    if (confirm(confirmMsg)) {
      this.deviceService.reportLost();
    }
  }

  private async refreshDeviceTracks() {
    const tracks = await this.deviceService.wifi.getDeviceTracks();
    this.deviceTracks.set(tracks);
  }
}
