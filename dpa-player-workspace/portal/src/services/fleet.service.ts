
import { Injectable, signal } from '@angular/core';
import { Observable, timer } from 'rxjs';
import { map } from 'rxjs/operators';

export interface ActivityEvent {
  id: string;
  type: 'PLAY' | 'SALE' | 'ROYALTY' | 'ACTIVATION';
  message: string;
  location: string;
  timestamp: Date;
}

export interface Activation {
  lat: number;
  lon: number;
  activity: number; // 0-1
}

export interface Region {
  code: string;
  name: string;
  percentage: number;
}

export interface Kpis {
  activeDevices: number;
  totalPlays: number;
  totalRoyalties: number;
  marketVolume: number;
}

@Injectable({
  providedIn: 'root'
})
export class FleetService {

  private locations = [
    { name: 'United States', lat: 37.0902, lon: -95.7129 },
    { name: 'Japan', lat: 36.2048, lon: 138.2529 },
    { name: 'United Kingdom', lat: 55.3781, lon: -3.4360 },
    { name: 'Germany', lat: 51.1657, lon: 10.4515 },
    { name: 'Brazil', lat: -14.2350, lon: -51.9253 },
    { name: 'South Korea', lat: 35.9078, lon: 127.7669 },
    { name: 'France', lat: 46.2276, lon: 2.2137 },
    { name: 'Canada', lat: 56.1304, lon: -106.3468 },
    { name: 'Australia', lat: -25.2744, lon: 133.7751 },
  ];

  private trackNames = ['Neon Rain', 'Cyber Heart', 'Analog Dreams', 'Starlight Echo', 'Digital Sea'];

  constructor() {}

  getKpis() {
    return signal<Kpis>({
      activeDevices: 4210,
      totalPlays: 188430,
      totalRoyalties: 24260.19,
      marketVolume: 148250.00
    });
  }

  getActivations() {
    return signal<Activation[]>(
      this.locations.flatMap(loc => 
        Array.from({ length: Math.floor(Math.random() * 5) + 2 }, () => ({
          lat: loc.lat + (Math.random() - 0.5) * 8,
          lon: loc.lon + (Math.random() - 0.5) * 8,
          activity: Math.random()
        }))
      )
    );
  }

  getTopRegions() {
    return signal<Region[]>([
      { code: 'US', name: 'United States', percentage: 45 },
      { code: 'JP', name: 'Japan', percentage: 21 },
      { code: 'UK', name: 'United Kingdom', percentage: 14 },
      { code: 'DE', name: 'Germany', percentage: 9 },
      { code: 'KR', name: 'South Korea', percentage: 6 },
    ]);
  }

  getActivityStream(): Observable<ActivityEvent> {
    return timer(0, 3000).pipe(
      map(() => this.generateRandomEvent())
    );
  }

  private generateRandomEvent(): ActivityEvent {
    const randomType = Math.random();
    const location = this.locations[Math.floor(Math.random() * this.locations.length)].name;
    const id = Math.random().toString(36).substring(2, 9);
    
    if (randomType < 0.6) { // 60% chance of PLAY
      const track = this.trackNames[Math.floor(Math.random() * this.trackNames.length)];
      return { id, type: 'PLAY', message: `'${track}' played`, location, timestamp: new Date() };
    } else if (randomType < 0.8) { // 20% chance of SALE
      const price = (Math.random() * 100 + 50).toFixed(2);
      return { id, type: 'SALE', message: `Device sold for $${price}`, location, timestamp: new Date() };
    } else if (randomType < 0.95) { // 15% chance of ROYALTY
      const royalty = (Math.random() * 10 + 5).toFixed(2);
      return { id, type: 'ROYALTY', message: `+$${royalty} royalty earned`, location, timestamp: new Date() };
    } else { // 5% chance of ACTIVATION
      return { id, type: 'ACTIVATION', message: 'New device activated', location, timestamp: new Date() };
    }
  }
}
