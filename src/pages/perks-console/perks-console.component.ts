
import { Component, inject, computed } from '@angular/core';
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
            action: 'download' // Simulate downloading the video asset
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

      this.dataService.createDcnpEvent(a.albumId, {
        eventType: type as any,
        payload: payload
      });

      // Push capsule notification to device if WiFi connected
      if (this.connectionService.connectionStatus() === 'wifi') {
        this.connectionService.wifi.pushCapsule(
          type as DcnpEventType,
          `cap-${Date.now().toString(36)}`,
          payload
        ).then(ok => {
          if (ok) console.log('[Perks] Capsule pushed to device');
          else console.warn('[Perks] Failed to push capsule to device');
        });
      }

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
}
