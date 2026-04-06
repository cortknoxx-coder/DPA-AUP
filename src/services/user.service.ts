
import { Injectable, signal } from '@angular/core';
// FIX: Import UserProfile from the shared types file.
import { PaymentMethod, RegionStat, TopAsset, UserProfile } from '../types';

export interface Financials {
  totalEarnings: number;
  currentBalance: number;
  royaltySource: number;  // Secondary market
  dpaSalesSource: number; // Primary hardware sales
  perksSource: number;    // DCNP digital sales
}

export interface EarningPoint {
  date: string;
  amount: number;
}

@Injectable({
  providedIn: 'root'
})
export class UserService {
  userProfile = signal<UserProfile>({
    name: '',
    artistName: '',
    email: ''
  });

  financials = signal<Financials>({
    totalEarnings: 0,
    currentBalance: 0,
    royaltySource: 0,
    dpaSalesSource: 0,
    perksSource: 0
  });

  paymentMethods = signal<PaymentMethod[]>([]);

  earningsHistory = signal<EarningPoint[]>([]);

  regionStats = signal<RegionStat[]>([]);

  topAssets = signal<TopAsset[]>([]);

  constructor() {}

  updateProfile(profile: UserProfile) {
    this.userProfile.set(profile);
    // In a real app, this would be an API call.
  }

  addPaymentMethod(method: Omit<PaymentMethod, 'id'>) {
    const newMethod: PaymentMethod = {
      ...method,
      id: Math.random().toString(36).substr(2, 9)
    };
    
    this.paymentMethods.update(current => {
      if (newMethod.isDefault || current.length === 0) {
        return [...current.map(m => ({...m, isDefault: false})), {...newMethod, isDefault: true}];
      }
      return [...current, newMethod];
    });
  }

  deletePaymentMethod(methodId: string) {
    this.paymentMethods.update(current => {
      const toDelete = current.find(m => m.id === methodId);
      const remaining = current.filter(m => m.id !== methodId);
      // If we delete the default method, make the first remaining one the new default
      if (toDelete?.isDefault && remaining.length > 0) {
        remaining[0].isDefault = true;
      }
      return remaining;
    });
  }

  setDefaultPaymentMethod(methodId: string) {
    this.paymentMethods.update(current => 
      current.map(m => ({
        ...m,
        isDefault: m.id === methodId
      }))
    );
  }

  withdraw(amount: number) {
    this.financials.update(f => ({
      ...f,
      currentBalance: f.currentBalance - amount
    }));
  }

  recordTransaction(amount: number) {
    // Simulate instant payout to artist balance from capsule sales
    this.financials.update(f => ({
      ...f,
      currentBalance: f.currentBalance + amount,
      totalEarnings: f.totalEarnings + amount,
      perksSource: f.perksSource + amount
    }));
  }
}
