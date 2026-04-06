
import { Component, inject, computed, signal, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { toSignal } from '@angular/core/rxjs-interop';
import { DataService } from '../../services/data.service';
import { DeviceConnectionService } from '../../services/device-connection.service';
import { DcnpPayload, DcnpEventType } from '../../types';

@Component({
  selector: 'app-perks-console',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './perks-console.component.html'
})
export class PerksConsoleComponent {
  private static readonly MAX_CAPSULE_PAYLOAD_BYTES = 12 * 1024;
  private static readonly MAX_CAPSULE_IMAGE_BYTES = 8 * 1024;

  private route = inject(ActivatedRoute);
  private dataService = inject(DataService);
  private fb: FormBuilder = inject(FormBuilder);
  private connectionService = inject(DeviceConnectionService);

  private id = computed(() => this.route.parent?.snapshot.params['id']);
  album = computed(() => this.dataService.getAlbum(this.id())());

  // Form State
  form = this.fb.group({
    eventType: ['concert', Validators.required],
    title: ['', Validators.required],
    description: [''],
    imageUrl: [''], // base64
    
    // -- Type Specific Inputs --
    
    // Concert
    venue: [''],
    eventDate: [''],
    ticketUrl: [''],
    
    // Video
    videoPrice: [0],
    isExclusive: [false],
    videoUrl: [''], // simulated
    
    // Merch
    merchUrl: [''],
    discountCode: [''],
    
    // Remix/Stem
    stemPrice: [0],
    fileFormat: ['WAV'],
    
    // Signing
    signingDate: [''],
    capacity: [100],
    
    // Generic / Other
    ctaLabel: [''],
    ctaUrl: ['']
  });
  
  // Signal to track current type for template conditional rendering
  selectedType = toSignal(this.form.get('eventType')!.valueChanges, { initialValue: 'concert' });
  pushState = signal<'idle' | 'pushing' | 'ok' | 'error'>('idle');
  pushMessage = signal<string>('');
  private lastPushRequest = signal<{ albumId: string; eventType: DcnpEventType; capsuleId: string; payload: DcnpPayload } | null>(null);
  private reconciled = false;

  constructor() {
    effect(() => {
      const conn = this.connectionService.connectionStatus();
      const a = this.album();
      if (conn === 'wifi' && a && !this.reconciled) {
        this.reconciled = true;
        void this.reconcileWithDevice(a.albumId);
      }
      if (conn !== 'wifi') {
        this.reconciled = false;
      }
    });
  }

  private async reconcileWithDevice(albumId: string) {
    try {
      const deviceCaps = await this.connectionService.wifi.getCapsules();
      const deliveredIds = new Set(deviceCaps.filter((c: any) => c.id).map((c: any) => c.id as string));
      const album = this.album();
      if (!album) return;
      for (const ev of album.dcnpEvents) {
        if (ev.status === 'pending' && deliveredIds.has(ev.id)) {
          this.dataService.markDcnpEventDelivered(albumId, ev.id);
        }
      }
    } catch { /* device may not support this yet */ }
  }

  create() {
    if (this.form.invalid) return;

    const a = this.album();
    const val = this.form.value;
    const type = val.eventType;

    if (a && type) {
      let payload: DcnpPayload = {
        title: val.title!,
        description: val.description || undefined,
        imageUrl: val.imageUrl || undefined,
      };

      // Construct Payload based on Type
      switch (type) {
        case 'concert':
          payload.cta = {
            label: 'Get Tickets',
            url: val.ticketUrl || '#',
            action: 'link'
          };
          payload.metadata = {
            venue: val.venue || '',
            date: val.eventDate || ''
          };
          // Append details to description for display simplicity
          if (val.venue) payload.description = `${val.venue} • ${val.eventDate}\n\n${payload.description || ''}`;
          break;

        case 'video':
          payload.price = val.videoPrice || 0;
          payload.cta = {
            label: val.videoPrice ? `Buy & Watch ($${val.videoPrice})` : 'Watch Video',
            url: val.videoUrl || undefined,
            action: 'download'
          };
          payload.metadata = {
            exclusive: val.isExclusive || false
          };
          break;

        case 'merch':
          payload.cta = {
            label: 'Shop Now',
            url: val.merchUrl || '#',
            action: 'link'
          };
          payload.metadata = {
            discountCode: val.discountCode || ''
          };
          if (val.discountCode) payload.description = `Use code: ${val.discountCode}\n\n${payload.description || ''}`;
          break;

        case 'remix':
          payload.price = val.stemPrice || 0;
          payload.cta = {
            label: val.stemPrice ? `Purchase Stems ($${val.stemPrice})` : 'Download Stems',
            action: 'download'
          };
          payload.metadata = {
            format: val.fileFormat || 'WAV'
          };
          break;

        case 'signing':
          payload.cta = {
            label: 'Join Queue',
            action: 'link', // e.g. a zoom link
            url: '#'
          };
          payload.metadata = {
            capacity: val.capacity || 100,
            date: val.signingDate || ''
          };
          payload.description = `Digital Signing Event on ${val.signingDate}. Limited to ${val.capacity} fans.\n\n${payload.description || ''}`;
          break;

        case 'other':
          if (val.ctaLabel) {
            payload.cta = {
              label: val.ctaLabel,
              url: val.ctaUrl || '#',
              action: val.ctaUrl ? 'link' : 'download'
            };
          }
          break;
      }

      if (!this.validatePayloadCaps(payload)) {
        return;
      }

      const capsuleId = `cap-${Date.now().toString(36)}`;

      this.dataService.createDcnpEvent(a.albumId, {
        id: capsuleId,
        eventType: type as any,
        payload: payload
      });

      const req = {
        albumId: a.albumId,
        eventType: type as DcnpEventType,
        capsuleId,
        payload
      };
      this.lastPushRequest.set(req);
      void this.pushToDevice(req, false);

      // Reset form but keep type for convenience
      const currentType = this.form.get('eventType')?.value;
      this.form.reset({ 
        eventType: currentType,
        videoPrice: 0,
        stemPrice: 0,
        capacity: 100,
        fileFormat: 'WAV',
        isExclusive: false
      });
    }
  }

  async retryLastPush() {
    const req = this.lastPushRequest();
    if (!req) return;
    await this.pushToDevice(req, true);
  }

  onFileSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files[0]) {
      const reader = new FileReader();
      reader.onload = (e) => {
        this.form.patchValue({ imageUrl: e.target?.result as string });
      };
      reader.readAsDataURL(input.files[0]);
      input.value = '';
    }
  }

  removeImage() {
    this.form.patchValue({ imageUrl: '' });
  }

  private validatePayloadCaps(payload: DcnpPayload): boolean {
    const imageSize = payload.imageUrl ? this.byteLen(payload.imageUrl) : 0;
    const payloadSize = this.byteLen(JSON.stringify(payload));

    if (imageSize > PerksConsoleComponent.MAX_CAPSULE_IMAGE_BYTES) {
      this.pushState.set('error');
      this.pushMessage.set(
        `Image too large for device capsule (${Math.round(imageSize / 1024)}KB). Max is ${Math.round(PerksConsoleComponent.MAX_CAPSULE_IMAGE_BYTES / 1024)}KB.`
      );
      return false;
    }

    if (payloadSize > PerksConsoleComponent.MAX_CAPSULE_PAYLOAD_BYTES) {
      this.pushState.set('error');
      this.pushMessage.set(
        `Capsule payload too large (${Math.round(payloadSize / 1024)}KB). Max is ${Math.round(PerksConsoleComponent.MAX_CAPSULE_PAYLOAD_BYTES / 1024)}KB.`
      );
      return false;
    }
    return true;
  }

  private async pushToDevice(
    req: { albumId: string; eventType: DcnpEventType; capsuleId: string; payload: DcnpPayload },
    isRetry: boolean
  ) {
    if (this.connectionService.connectionStatus() !== 'wifi') {
      this.pushState.set('error');
      this.pushMessage.set('Device not connected on Wi-Fi. Connect and press Retry Push.');
      return;
    }

    this.pushState.set('pushing');
    this.pushMessage.set(isRetry ? 'Retrying capsule push...' : 'Pushing capsule to device...');
    const ok = await this.connectionService.wifi.pushCapsule(req.eventType, req.capsuleId, req.payload);
    if (ok) {
      this.dataService.markDcnpEventDelivered(req.albumId, req.capsuleId);
      this.pushState.set('ok');
      this.pushMessage.set('Capsule delivered to connected device.');
    } else {
      this.pushState.set('error');
      this.pushMessage.set('Device push failed. Verify connectivity and retry.');
    }
  }

  private byteLen(value: string): number {
    return new TextEncoder().encode(value).length;
  }
}
