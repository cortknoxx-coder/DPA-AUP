
import { Component, inject, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { DeviceConnectionService } from '../../services/device-connection.service';

@Component({
  selector: 'app-fan-auth',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './fan-auth.component.html',
})
export class FanAuthComponent {
  private deviceService = inject(DeviceConnectionService);
  private router = inject(Router);

  constructor() {
    // If already connected when reaching this page, redirect immediately.
    if (this.deviceService.connectionStatus() !== 'disconnected') {
      this.router.navigate(['/fan/app/home']);
    }

    // Effect to react to connection status changes
    effect(() => {
      if (this.deviceService.connectionStatus() !== 'disconnected') {
        this.router.navigate(['/fan/app/home']);
      }
    });
  }

  connectUSB() {
    this.deviceService.connectToBridge();
  }

  connectNFC() {
    alert('NFC connection is for mobile devices. This is a desktop simulation.');
  }

  connectBluetooth() {
    alert('Bluetooth connection not implemented in this demo. Please use USB-C Bridge or Simulator.');
  }
  
  useSimulator() {
    this.deviceService.toggleSimulator();
  }
}
