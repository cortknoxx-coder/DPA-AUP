
import { Injectable, signal, computed, inject } from '@angular/core';
import { DeviceBridgeService } from './device-bridge.service';

export type ConnectionStatus = 'disconnected' | 'usb' | 'bluetooth';
export type RegistrationStatus = 'unregistered' | 'analyzing' | 'registered' | 'lost';

@Injectable({
  providedIn: 'root'
})
export class DeviceConnectionService {
  private bridge = inject(DeviceBridgeService);

  connectionStatus = signal<ConnectionStatus>('disconnected');
  
  // Registration State
  registrationStatus = signal<RegistrationStatus>('unregistered');
  registeredDeviceId = signal<string | null>(null);
  
  // Derived state for the UI
  isSnippetMode = computed(() => this.registrationStatus() !== 'registered');

  // Simulator Flag
  private isSimulated = false;

  constructor() {}

  async cycleConnection() {
    // Current Logic: Toggle connection states
    // New Logic: Try to connect to Bridge first. If fail, toggle simulation modes.
    
    if (this.connectionStatus() === 'disconnected') {
      // Attempt Bridge Connection
      const connected = await this.bridge.connect();
      if (connected) {
        this.connectionStatus.set('usb'); // Assume USB for bridge
        this.isSimulated = false;
        // Auto-check device info
        this.checkDevice();
      } else {
        // Fallback to Simulator
        this.isSimulated = true;
        this.connectionStatus.set('usb');
        console.warn('DPA Bridge unavailable. Entering Simulator Mode.');
      }
    } else if (this.connectionStatus() === 'usb') {
      this.connectionStatus.set('bluetooth');
    } else {
      this.connectionStatus.set('disconnected');
      this.isSimulated = false;
      this.registeredDeviceId.set(null);
      this.registrationStatus.set('unregistered');
    }
  }

  private async checkDevice() {
    if (!this.isSimulated && this.bridge.isConnected()) {
      try {
        const info = await this.bridge.getDeviceInfo();
        if (info.serial) {
          // Auto-register for demo purposes if bridge is live
          this.registrationStatus.set('registered');
          this.registeredDeviceId.set(info.serial);
        }
      } catch (e) {
        console.error('Failed to get device info', e);
      }
    }
  }

  // Simulate Device Licensing Process
  registerDevice(deviceId: string): Promise<boolean> {
    this.registrationStatus.set('analyzing');
    
    return new Promise((resolve) => {
      // If connected to real bridge, we would verify here.
      // For now, we simulate the logic or use the bridge data.
      
      setTimeout(async () => {
        let valid = false;

        if (!this.isSimulated && this.bridge.isConnected()) {
           // Real verification against device attest
           try {
             const info = await this.bridge.getDeviceInfo();
             valid = info.serial === deviceId;
           } catch { valid = false; }
        } else {
           // Sim verification
           valid = deviceId.toUpperCase().startsWith('DPA-');
        }

        if (valid) {
          this.registrationStatus.set('registered');
          this.registeredDeviceId.set(deviceId.toUpperCase());
          resolve(true);
        } else {
          this.registrationStatus.set('unregistered');
          resolve(false);
        }
      }, 3000); // 3 second analysis simulation
    });
  }

  unregisterDevice() {
    this.registrationStatus.set('unregistered');
    this.registeredDeviceId.set(null);
  }

  reportLost() {
    this.registrationStatus.set('lost');
    // In a real app, this would hit the API to blacklist the device hash
  }

  // Mock Email Verification for Unregister flow
  verifyEmail(email: string): Promise<boolean> {
    return new Promise(resolve => {
      setTimeout(() => {
        // Mock: Any email with '@' is valid for demo
        resolve(email.includes('@'));
      }, 1500);
    });
  }

  sendDeviceIdReminder(email: string): Promise<void> {
    return new Promise(resolve => {
      setTimeout(() => resolve(), 2000);
    });
  }

  // Helper for other services to know if we are in sim mode
  isSimulationMode() {
    return this.isSimulated;
  }
}
