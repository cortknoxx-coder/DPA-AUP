
import { Component, inject, signal, effect } from '@angular/core';
import { CommonModule, CurrencyPipe } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { UserService } from '../../services/user.service';
import { UserProfile } from '../../types';

@Component({
  selector: 'app-fan-settings',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, CurrencyPipe],
  templateUrl: './fan-settings.component.html',
})
export class FanSettingsComponent {
  private fb = inject(FormBuilder);
  userService = inject(UserService);

  // UI State
  showAddMethodModal = signal(false);

  // Forms
  profileForm = this.fb.group({
    name: ['', Validators.required],
    email: ['', [Validators.required, Validators.email]]
  });
  
  notificationsForm = this.fb.group({
    capsuleDrops: [true],
    marketplaceOffers: [true],
    weeklyDigest: [false]
  });

  addMethodForm = this.fb.group({
    type: ['card', Validators.required],
    name: ['', Validators.required],
    number: ['', [Validators.required, Validators.pattern(/^\d{16}$/)]],
    expiry: ['', [Validators.required, Validators.pattern(/^(0[1-9]|1[0-2])\/\d{2}$/)]],
    cvc: ['', [Validators.required, Validators.pattern(/^\d{3,4}$/)]]
  });

  constructor() {
    effect(() => {
      const user = this.userService.userProfile();
      // Using `reset` instead of `setValue` to avoid errors if the form structure diverges slightly
      this.profileForm.reset({
        name: user.name,
        email: user.email
      });
    });
  }

  saveProfile() {
    if (this.profileForm.valid) {
      const updatedProfile: Partial<UserProfile> = {
        name: this.profileForm.value.name!,
        email: this.profileForm.value.email!,
      };
      const currentProfile = this.userService.userProfile();
      this.userService.updateProfile({ ...currentProfile, ...updatedProfile });
      this.profileForm.markAsPristine();
      alert('Profile updated successfully!');
    }
  }

  submitAddMethod() {
    if (this.addMethodForm.invalid) return;

    const val = this.addMethodForm.value;
    
    this.userService.addPaymentMethod({
      type: 'card',
      name: `${val.name}`,
      last4: val.number?.slice(-4) || '0000',
      isDefault: false
    });
    
    this.showAddMethodModal.set(false);
    this.addMethodForm.reset({ type: 'card' });
  }

  deletePaymentMethod(id: string) {
    if (confirm('Are you sure you want to remove this payment method?')) {
      this.userService.deletePaymentMethod(id);
    }
  }

  setDefaultPaymentMethod(id: string) {
    this.userService.setDefaultPaymentMethod(id);
  }
}
