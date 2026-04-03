
import { Component, inject, signal, effect, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { DeviceConnectionService } from '../../services/device-connection.service';
import { UserService } from '../../services/user.service';
import { DevicePreviewComponent } from '../../components/device-preview/device-preview.component';
import { Theme, LedPattern, DeviceTrack } from '../../types';

type ViewState = 'dashboard' | 'unregister-auth' | 'unregister-confirm';

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
  ledPreviewMode = signal<'idle' | 'playback' | 'charging'>('idle');
  isPushingTheme = signal(false);
  pushStatus = signal<'idle' | 'pushing' | 'ok' | 'error'>('idle');
  pushMessage = signal<string>('');
  deviceTracks = signal<DeviceTrack[]>([]);
  realTimeMode = signal(false);
  brightness = signal(80);

  ledForm = this.fb.group({
    idle: this.fb.group({ color: ['#00ff88'], pattern: ['breathing'] }),
    playback: this.fb.group({ color: ['#00aaff'], pattern: ['pulse'] }),
    charging: this.fb.group({ color: ['#ffaa00'], pattern: ['breathing'] }),
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
    return (this.ledForm.value as any)[mode]?.pattern || 'breathing';
  }

  constructor() {
    // Auto-push when real-time mode is on
    effect(() => {
      const rtm = this.realTimeMode();
      if (!rtm) return;

      // Subscribe to form value changes for real-time push
      const sub = this.ledForm.valueChanges.subscribe(() => {
        if (this.realTimeMode()) {
          this.pushThemeToDevice(true);
        }
      });

      const dcnpSub = this.dcnpForm.valueChanges.subscribe(() => {
        if (this.realTimeMode()) {
          this.pushThemeToDevice(true);
        }
      });

      // Cleanup on effect re-run
      return () => {
        sub.unsubscribe();
        dcnpSub.unsubscribe();
      };
    });

    effect(() => {
      if (this.deviceService.connectionStatus() === 'wifi') {
        this.refreshDeviceTracks();
      } else {
        this.deviceTracks.set([]);
      }
    }, { allowSignalWrites: true });
  }

  setLedPreviewMode(mode: 'idle' | 'playback' | 'charging') {
    this.ledPreviewMode.set(mode);
  }

  async pushThemeToDevice(silent = false) {
    if (this.deviceService.connectionStatus() !== 'wifi' && !this.deviceService.isSimulationMode()) {
      if (!silent) {
        this.pushStatus.set('error');
        this.pushMessage.set('Connect to your DPA via WiFi to push theme changes. Join the device WiFi network first.');
      }
      return;
    }

    this.isPushingTheme.set(true);
    this.pushStatus.set('pushing');
    if (!silent) this.pushMessage.set('Pushing theme to device...');
    const led = this.ledForm.value as Theme['led'];
    const dcnp = this.dcnpForm.value as Theme['dcnp'];
    const success = await this.deviceService.wifi.pushTheme({ led, dcnp } as Theme, this.brightness());
    this.isPushingTheme.set(false);

    if (success) {
      this.pushStatus.set('ok');
      if (!silent) this.pushMessage.set('Theme pushed to device.');
    } else {
      this.pushStatus.set('error');
      if (!silent) this.pushMessage.set('Failed to push theme. Verify device WiFi and retry.');
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
