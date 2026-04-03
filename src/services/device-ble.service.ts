
import { Injectable, signal } from '@angular/core';
import { DpaDeviceInfo, FirmwareStatus } from '../types';

// BLE UUIDs matching firmware dpa-fan-sim.ino
const SVC_INFO = 0xd1a0;
const CHR_DUID = 0xd1a1;
const CHR_STATUS = 0xd1a2;
const CHR_FWVER = 0xd1a3;
const SVC_CTRL = 0xd1d0;
const CHR_CMD = 0xd1d1;

// Device commands
export const BLE_CMD = {
  PLAY: 0x01,
  PAUSE: 0x02,
  NEXT: 0x03,
  PREV: 0x04,
  GET_STATUS: 0x10,
  BT_PAIRING: 0x20,
  START_PORTAL: 0x30,
  STOP_PORTAL: 0x31,
  ESPNOW_SYNC: 0x40,
  ESPNOW_DISCOVER: 0x41,
  A2DP_SCAN: 0x50,
  A2DP_CONNECT: 0x51,
  A2DP_DISCONNECT: 0x52,
  VOLUME_UP: 0x60,
  VOLUME_DOWN: 0x61,
  CYCLE_MODE: 0x62,
  CYCLE_EQ: 0x63,
} as const;

@Injectable({ providedIn: 'root' })
export class DeviceBleService {
  private device: BluetoothDevice | null = null;
  private server: BluetoothRemoteGATTServer | null = null;
  private cmdCharacteristic: BluetoothRemoteGATTCharacteristic | null = null;
  private statusCharacteristic: BluetoothRemoteGATTCharacteristic | null = null;

  isConnected = signal(false);
  lastStatus = signal<FirmwareStatus | null>(null);
  duid = signal<string | null>(null);
  firmwareVersion = signal<string | null>(null);

  get isSupported(): boolean {
    return 'bluetooth' in navigator;
  }

  async scan(): Promise<BluetoothDevice | null> {
    if (!this.isSupported) {
      throw new Error('Web Bluetooth is not supported in this browser. Use Chrome, Edge, or Opera.');
    }

    try {
      const device = await navigator.bluetooth.requestDevice({
        filters: [{ services: [SVC_INFO] }],
        optionalServices: [SVC_CTRL],
      });
      return device;
    } catch (e: any) {
      if (e.name === 'NotFoundError') return null; // User cancelled
      throw e;
    }
  }

  async connect(device?: BluetoothDevice): Promise<boolean> {
    try {
      if (!device) {
        device = (await this.scan()) ?? undefined;
        if (!device) return false;
      }

      this.device = device;
      this.device.addEventListener('gattserverdisconnected', () => this.onDisconnected());

      this.server = await device.gatt!.connect();

      // Read info service
      const infoService = await this.server.getPrimaryService(SVC_INFO);

      const duidChar = await infoService.getCharacteristic(CHR_DUID);
      const duidValue = await duidChar.readValue();
      this.duid.set(new TextDecoder().decode(duidValue));

      const fwChar = await infoService.getCharacteristic(CHR_FWVER);
      const fwValue = await fwChar.readValue();
      this.firmwareVersion.set(new TextDecoder().decode(fwValue));

      // Subscribe to status notifications
      this.statusCharacteristic = await infoService.getCharacteristic(CHR_STATUS);
      await this.statusCharacteristic.startNotifications();
      this.statusCharacteristic.addEventListener('characteristicvaluechanged', (event: Event) => {
        const target = event.target as BluetoothRemoteGATTCharacteristic;
        const json = new TextDecoder().decode(target.value!);
        try {
          const status = JSON.parse(json) as FirmwareStatus;
          this.lastStatus.set(status);
        } catch {
          console.warn('[BLE] Failed to parse status JSON:', json);
        }
      });

      // Get control service for commands
      const ctrlService = await this.server.getPrimaryService(SVC_CTRL);
      this.cmdCharacteristic = await ctrlService.getCharacteristic(CHR_CMD);

      this.isConnected.set(true);

      // Request initial status
      await this.sendCommand(BLE_CMD.GET_STATUS);

      return true;
    } catch (e) {
      console.error('[BLE] Connection failed:', e);
      this.disconnect();
      return false;
    }
  }

  async sendCommand(cmd: number): Promise<void> {
    if (!this.cmdCharacteristic) {
      throw new Error('BLE not connected');
    }
    const data = new Uint8Array([cmd]);
    await this.cmdCharacteristic.writeValue(data);
  }

  disconnect(): void {
    if (this.device?.gatt?.connected) {
      this.device.gatt.disconnect();
    }
    this.cleanup();
  }

  getDeviceInfo(): DpaDeviceInfo | null {
    if (!this.duid()) return null;
    return {
      serial: this.duid()!,
      model: 'DPA Silver',
      firmwareVersion: this.firmwareVersion() || 'unknown',
      capabilities: ['audio', 'portal', 'mesh'],
      pubkeyB64: '',
    };
  }

  private onDisconnected(): void {
    console.log('[BLE] Device disconnected');
    this.cleanup();
  }

  private cleanup(): void {
    this.server = null;
    this.cmdCharacteristic = null;
    this.statusCharacteristic = null;
    this.device = null;
    this.isConnected.set(false);
  }
}
