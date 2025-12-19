
import { Injectable, signal } from '@angular/core';
import { PaymentMethod, RegionStat, TopAsset } from '../types';

export interface UserProfile {
  name: string;
  artistName: string;
  email: string;
}

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
    name: 'Jane Doe',
    artistName: '808 Dreams',
    email: 'jane.doe@example.com'
  });

  financials = signal<Financials>({
    totalEarnings: 352840.21,
    currentBalance: 9430.75,
    royaltySource: 24260.19,
    dpaSalesSource: 311588.02,
    perksSource: 16992.00
  });

  paymentMethods = signal<PaymentMethod[]>([
    { id: 'pm_1', type: 'bank', name: 'Chase Checking', last4: '8842', isDefault: true }
  ]);

  earningsHistory = signal<EarningPoint[]>([
    { date: '2024-01-01', amount: 12000 },
    { date: '2024-02-01', amount: 15500 },
    { date: '2024-03-01', amount: 14200 },
    { date: '2024-04-01', amount: 18900 },
    { date: '2024-05-01', amount: 22400 },
    { date: '2024-06-01', amount: 21800 },
    { date: '2024-07-01', amount: 25600 },
    { date: '2024-08-01', amount: 29500 },
    { date: '2024-09-01', amount: 28100 },
    { date: '2024-10-01', amount: 32400 },
    { date: '2024-11-01', amount: 38900 },
    { date: '2024-12-01', amount: 42500 },
  ]);

  // Regional Data
  regionStats = signal<RegionStat[]>([
    { regionCode: 'US', regionName: 'United States', deviceSales: 1250, streamingSessions: 45000, revenue: 52000, percentage: 45 },
    { regionCode: 'JP', regionName: 'Japan', deviceSales: 840, streamingSessions: 32000, revenue: 38500, percentage: 28 },
    { regionCode: 'UK', regionName: 'United Kingdom', deviceSales: 420, streamingSessions: 15000, revenue: 18200, percentage: 14 },
    { regionCode: 'DE', regionName: 'Germany', deviceSales: 310, streamingSessions: 8000, revenue: 12400, percentage: 9 },
    { regionCode: 'BR', regionName: 'Brazil', deviceSales: 150, streamingSessions: 12000, revenue: 4500, percentage: 4 },
  ]);

  // Top Performers
  topAssets = signal<TopAsset[]>([
    { id: '1', title: 'Midnight Horizons', type: 'album', totalPlays: 124000, revenue: 62000, trend: 12.5 },
    { id: '2', title: 'Neon Rain', type: 'track', totalPlays: 54000, revenue: 8400, trend: 5.2 },
    { id: '3', title: 'Cyber Heart', type: 'track', totalPlays: 42000, revenue: 6100, trend: -2.1 },
    { id: '4', title: 'Echoes of Silence', type: 'album', totalPlays: 8000, revenue: 4200, trend: 150.0 }
  ]);

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
      if (newMethod.isDefault) {
        return [...current.map(m => ({...m, isDefault: false})), newMethod];
      }
      return [...current, newMethod];
    });
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
