
import { Component, inject, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { DataService } from '../../services/data.service';

@Component({
  selector: 'app-perks-console',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './perks-console.component.html'
})
export class PerksConsoleComponent {
  private route = inject(ActivatedRoute);
  private dataService = inject(DataService);
  private fb = inject(FormBuilder);

  private id = computed(() => this.route.parent?.snapshot.params['id']);
  album = computed(() => this.dataService.getAlbum(this.id())());

  // Form State
  form = this.fb.group({
    eventType: ['concert', Validators.required],
    title: ['', Validators.required],
    description: [''],
    imageUrl: [''], // base64
    ctaLabel: [''],
    ctaUrl: ['']
  });

  create() {
    if (this.form.invalid) return;

    const a = this.album();
    const val = this.form.value;

    if (a) {
      this.dataService.createDcnpEvent(a.albumId, {
        eventType: val.eventType as any,
        payload: {
          title: val.title!,
          description: val.description || undefined,
          imageUrl: val.imageUrl || undefined,
          cta: (val.ctaLabel && val.ctaUrl) ? { label: val.ctaLabel, url: val.ctaUrl } : undefined
        }
      });
      this.form.reset({ eventType: 'concert' });
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
      // Reset file input value to allow re-uploading the same file
      input.value = '';
    }
  }

  removeImage() {
    this.form.patchValue({ imageUrl: '' });
  }
}
