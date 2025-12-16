
import { Component, inject, signal } from '@angular/core';
import { CommonModule, DatePipe, CurrencyPipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { DataService } from '../../services/data.service';
import { UserService } from '../../services/user.service';
import { DeviceConnectionService } from '../../services/device-connection.service';
import { DcnpEvent } from '../../types';

@Component({
  selector: 'app-fan-capsules',
  standalone: true,
  imports: [CommonModule, RouterLink, DatePipe, CurrencyPipe],
  templateUrl: './fan-capsules.component.html',
})
export class FanCapsulesComponent {
  private dataService = inject(DataService);
  private userService = inject(UserService);
  private connectionService = inject(DeviceConnectionService);
  
  allCapsules = this.dataService.getAllCapsules();

  // Local state for tracking downloads
  // Map of capsule ID -> progress (0-100), or 'installed'
  downloadState = signal<Record<string, number | 'installed'>>({});

  onInteraction(capsule: DcnpEvent) {
    if (!capsule.payload.cta) return;

    // Type 1: External Link (Merch, Concert)
    if (capsule.payload.cta.action === 'link') {
      window.open(capsule.payload.cta.url, '_blank');
      return;
    }

    // Type 2: Digital Download (Remix, Video, BTS)
    if (capsule.payload.cta.action === 'download') {
      this.handleDownload(capsule);
    }
  }

  handleDownload(capsule: DcnpEvent) {
    const currentState = this.downloadState()[capsule.id];
    if (currentState === 'installed') return;

    // 1. Check Connection
    if (this.connectionService.connectionStatus() === 'disconnected') {
      alert('DPA Device Required: Please connect your device via USB-C or Bluetooth to transfer this content securely.');
      return;
    }

    // 2. Handle Payment if applicable
    if (capsule.payload.price && capsule.payload.price > 0) {
      const confirmMsg = `Confirm Purchase: $${capsule.payload.price}\n\nThis will be charged to your default payment method and funds will be transferred to ${capsule.payload.cta?.label.includes('Remix') ? 'the Artist' : 'the Artist'} immediately.`;
      
      if (!confirm(confirmMsg)) return;

      // Simulate sending money to artist
      this.userService.recordTransaction(capsule.payload.price);
    }

    // 3. Simulate Transfer Process
    this.simulateTransfer(capsule.id);
  }

  simulateTransfer(id: string) {
    let progress = 0;
    this.updateState(id, 0);

    const interval = setInterval(() => {
      progress += 5;
      this.updateState(id, progress);

      if (progress >= 100) {
        clearInterval(interval);
        this.updateState(id, 'installed');
      }
    }, 100);
  }

  updateState(id: string, val: number | 'installed') {
    this.downloadState.update(curr => ({
      ...curr,
      [id]: val
    }));
  }
}
