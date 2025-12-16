
import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DeviceConnectionService } from '../../services/device-connection.service';
import { UserService } from '../../services/user.service';

type ViewState = 'dashboard' | 'unregister-auth' | 'unregister-confirm';

@Component({
  selector: 'app-fan-device-registration',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './fan-device-registration.component.html'
})
export class FanDeviceRegistrationComponent {
  deviceService = inject(DeviceConnectionService);
  userService = inject(UserService);

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
    
    alert(`Device ID sent to ${this.authEmail()}. Check your inbox.`);
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
    alert('Device successfully unregistered. Reverting to Snippet Mode.');
  }

  // --- Lost Flow ---

  confirmLost() {
    const confirmMsg = "WARNING: Reporting your device as lost will immediately revoke its digital certificates. The device will revert to 'Snippet Mode' and cannot play encrypted content until verified by support.\n\nAre you sure?";
    if (confirm(confirmMsg)) {
      this.deviceService.reportLost();
    }
  }
}
