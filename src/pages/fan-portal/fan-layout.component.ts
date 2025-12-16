
import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterOutlet, RouterLink, RouterLinkActive } from '@angular/router';
import { PlayerService } from '../../services/player.service';
import { DeviceConnectionService } from '../../services/device-connection.service';

@Component({
  selector: 'app-fan-layout',
  standalone: true,
  imports: [CommonModule, RouterOutlet, RouterLink, RouterLinkActive],
  template: `
    <div class="h-screen flex flex-col bg-black text-slate-200 overflow-hidden font-sans">
      
      <!-- Main Content Area -->
      <div class="flex-1 flex overflow-hidden">
        
        <!-- Sidebar -->
        <nav class="w-64 bg-slate-950 border-r border-slate-900 flex-shrink-0 flex flex-col">
          <div class="p-6">
            <div class="flex items-center gap-2 mb-8">
              <div class="h-6 w-6 rounded bg-indigo-600 shadow-[0_0_12px_rgba(79,70,229,0.5)]"></div>
              <span class="font-bold text-lg tracking-tight text-white">DPA <span class="text-slate-500 font-normal">Player</span></span>
            </div>

            <div class="space-y-1">
              <a routerLink="/fan/home" routerLinkActive="bg-white/10 text-white" class="flex items-center gap-3 px-3 py-2 text-sm font-medium rounded-md text-slate-400 hover:text-white transition-colors">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" /></svg>
                Home
              </a>
              <a class="flex items-center gap-3 px-3 py-2 text-sm font-medium rounded-md text-slate-400 hover:text-white transition-colors cursor-not-allowed opacity-50">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
                Search
              </a>
              <a class="flex items-center gap-3 px-3 py-2 text-sm font-medium rounded-md text-slate-400 hover:text-white transition-colors cursor-not-allowed opacity-50">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" /></svg>
                Library
              </a>
            </div>

            <div class="mt-8">
              <h3 class="px-3 text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">My Devices</h3>
              <div class="space-y-1">
                 @if (connectionService.connectionStatus() !== 'disconnected') {
                   <div class="flex items-center gap-2 px-3 py-2 text-sm text-indigo-400 bg-indigo-500/10 rounded-md">
                     <span class="h-2 w-2 rounded-full bg-indigo-500 animate-pulse"></span>
                     DPA Silver Ed.
                   </div>
                 } @else {
                   <div class="px-3 py-2 text-xs text-slate-600 italic">No device connected</div>
                 }
              </div>
            </div>
            
            <div class="mt-8">
              <h3 class="px-3 text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Capsules</h3>
              <div class="space-y-1">
                 <div class="px-3 py-2 text-xs text-slate-600 italic">No unread drops</div>
              </div>
            </div>
          </div>
          
          <div class="mt-auto p-4 border-t border-slate-900">
             <a routerLink="/login" class="flex items-center gap-2 text-xs text-slate-500 hover:text-slate-300">
               <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" /></svg>
               Switch Profile
             </a>
          </div>
        </nav>

        <!-- Page Content -->
        <main class="flex-1 overflow-y-auto bg-gradient-to-b from-slate-900 to-black p-8">
          <router-outlet></router-outlet>
        </main>
      </div>

      <!-- Player Bar -->
      <div class="h-24 bg-slate-950 border-t border-slate-900 flex items-center px-4 justify-between shrink-0 z-50">
        
        <!-- Track Info -->
        <div class="flex items-center gap-4 w-1/3">
          @if (playerService.currentTrack(); as track) {
            <img [src]="track.coverUrl" class="h-14 w-14 rounded bg-slate-800 object-cover shadow-lg">
            <div class="min-w-0">
              <div class="text-sm font-medium text-white truncate">{{ track.title }}</div>
              <div class="text-xs text-slate-400 truncate">{{ track.artist }}</div>
            </div>
            <button class="text-slate-400 hover:text-white">
              <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" /></svg>
            </button>
          } @else {
            <div class="h-14 w-14 rounded bg-slate-900 flex items-center justify-center text-slate-700">
               <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" /></svg>
            </div>
            <div class="text-xs text-slate-600">DPA Ready</div>
          }
        </div>

        <!-- Controls -->
        <div class="flex flex-col items-center w-1/3">
           <div class="flex items-center gap-6 mb-2">
             <button class="text-slate-400 hover:text-white" (click)="playerService.prev()">
               <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path d="M8.445 14.832A1 1 0 0010 14v-2.798l5.445 3.63A1 1 0 0017 14V6a1 1 0 00-1.555-.832L10 8.798V6a1 1 0 00-1.555-.832l-6 4a1 1 0 000 1.664l6 4z" /></svg>
             </button>
             <button (click)="playerService.togglePlay()" class="h-10 w-10 rounded-full bg-white text-black flex items-center justify-center hover:scale-105 transition-transform">
               @if (playerService.isPlaying()) {
                 <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zM7 8a1 1 0 012 0v4a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v4a1 1 0 102 0V8a1 1 0 00-1-1z" clip-rule="evenodd" /></svg>
               } @else {
                 <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 ml-0.5" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clip-rule="evenodd" /></svg>
               }
             </button>
             <button class="text-slate-400 hover:text-white" (click)="playerService.next()">
               <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path d="M4.555 5.168A1 1 0 003 6v8a1 1 0 001.555.832L10 11.202V14a1 1 0 001.555.832l6-4a1 1 0 000-1.664l-6-4A1 1 0 0010 6v2.798l-5.445-3.63z" /></svg>
             </button>
           </div>
           <!-- Scrubber -->
           <div class="w-full flex items-center gap-2 text-[10px] text-slate-500 font-mono">
             <span>{{ formatTime(playerService.currentTime()) }}</span>
             <div class="flex-1 h-1 bg-slate-800 rounded-full overflow-hidden group cursor-pointer">
               <div class="h-full bg-white/80 group-hover:bg-indigo-500 rounded-full" [style.width.%]="playerService.progress()"></div>
             </div>
             <span>{{ playerService.currentTrack() ? formatTime(playerService.currentTrack()!.duration) : '0:00' }}</span>
           </div>
        </div>

        <!-- Volume & Source -->
        <div class="flex items-center justify-end gap-3 w-1/3">
           <div class="flex items-center gap-1 px-2 py-1 rounded bg-slate-900 border border-slate-800 text-[10px] uppercase font-bold tracking-wider" 
                [class.text-indigo-400]="connectionService.connectionStatus() === 'usb'"
                [class.border-indigo-500/30]="connectionService.connectionStatus() === 'usb'"
                [class.text-blue-400]="connectionService.connectionStatus() === 'bluetooth'">
             @if (connectionService.connectionStatus() === 'disconnected') {
               <span class="text-slate-500">Offline</span>
             } @else if (connectionService.connectionStatus() === 'usb') {
               <span>USB-C Source</span>
             } @else {
               <span>BT Source</span>
             }
           </div>
           
           <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" /></svg>
           <div class="w-20 h-1 bg-slate-800 rounded-full overflow-hidden">
             <div class="h-full bg-slate-400 w-3/4"></div>
           </div>
        </div>

      </div>
    </div>
  `
})
export class FanLayoutComponent {
  playerService = inject(PlayerService);
  connectionService = inject(DeviceConnectionService);

  formatTime(sec: number): string {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  }
}
