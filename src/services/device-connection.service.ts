import { Injectable, signal } from '@angular/core';

export type ConnectionStatus = 'disconnected' | 'usb' | 'bluetooth';

@Injectable({
  providedIn: 'root'
})
export class DeviceConnectionService {
  connectionStatus = signal<ConnectionStatus>('disconnected');

  constructor() {}

  cycleConnection() {
    this.connectionStatus.update(current => {
      if (current === 'disconnected') return 'usb';
      if (current === 'usb') return 'bluetooth';
      return 'disconnected';
    });
  }
}
