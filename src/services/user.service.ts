import { Injectable, signal } from '@angular/core';

export interface UserProfile {
  name: string;
  artistName: string;
  email: string;
}

export interface Financials {
  totalEarnings: number;
  currentBalance: number;
  royaltySource: number;
  dpaSalesSource: number;
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
    totalEarnings: 124567.89,
    currentBalance: 3210.45,
    royaltySource: 98765.43,
    dpaSalesSource: 25802.46
  });

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

  constructor() {}

  updateProfile(profile: UserProfile) {
    this.userProfile.set(profile);
    // In a real app, this would be an API call.
  }
}
