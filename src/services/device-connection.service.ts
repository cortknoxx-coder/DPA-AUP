
import { Injectable, signal, computed } from '@angular/core';

export type ConnectionStatus = 'disconnected' | 'usb' | 'bluetooth';
export type RegistrationStatus = 'unregistered' | 'analyzing' | 'registered' | 'lost';

@Injectable({
  providedIn: 'root'
})
export class DeviceConnectionService {
  connectionStatus = signal<ConnectionStatus>('disconnected');
  
  // Registration State
  registrationStatus = signal<RegistrationStatus>('unregistered');
  registeredDeviceId = signal<string | null>(null);
  
  // Derived state for the UI
  isSnippetMode = computed(() => this.registrationStatus() !== 'registered');

  constructor() {}

  cycleConnection() {
    this.connectionStatus.update(current => {
      if (current === 'disconnected') return 'usb';
      if (current === 'usb') return 'bluetooth';
      return 'disconnected';
    });
  }

  // Simulate Device Licensing Process
  registerDevice(deviceId: string): Promise<boolean> {
    this.registrationStatus.set('analyzing');
    
    return new Promise((resolve) => {
      setTimeout(() => {
        // Simulate check: Valid IDs start with "DPA-"
        if (deviceId.toUpperCase().startsWith('DPA-')) {
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
}
