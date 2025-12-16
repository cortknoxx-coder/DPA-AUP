
import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { DataService } from '../../services/data.service';

@Component({
  selector: 'app-create-album',
  standalone: true,
  imports: [CommonModule, RouterLink, ReactiveFormsModule],
  template: `
    <div class="max-w-xl mx-auto space-y-8">
      <div>
        <h1 class="text-2xl font-bold text-slate-50">Create New Album</h1>
        <p class="text-sm text-slate-400 mt-1">Initialize a new DPA project.</p>
      </div>

      <form [formGroup]="form" (ngSubmit)="onSubmit()" class="space-y-6 rounded-xl border border-slate-800 bg-slate-900/50 p-6">
        <div>
          <label class="block text-sm font-medium text-slate-300">Album Title</label>
          <input type="text" formControlName="title" 
            class="mt-2 block w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 focus:border-teal-500 focus:ring-1 focus:ring-teal-500 outline-none transition-all placeholder:text-slate-600"
            placeholder="e.g. Midnight Horizons">
        </div>

        <div class="pt-4 flex items-center justify-end gap-3">
          <a routerLink="/artist" class="px-4 py-2 text-sm text-slate-400 hover:text-slate-200">Cancel</a>
          <button type="submit" [disabled]="!form.valid"
            class="rounded-lg bg-teal-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-teal-500 disabled:opacity-50 disabled:cursor-not-allowed">
            Create Project
          </button>
        </div>
      </form>
    </div>
  `
})
export class CreateAlbumComponent {
  private fb = inject(FormBuilder);
  private dataService = inject(DataService);
  private router = inject(Router);

  form = this.fb.group({
    title: ['', Validators.required]
  });

  onSubmit() {
    if (this.form.valid) {
      const { title } = this.form.value;
      this.dataService.createAlbum(title!);
      this.router.navigate(['/artist']);
    }
  }
}
