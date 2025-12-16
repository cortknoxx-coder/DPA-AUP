import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-devices-dashboard',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
      <div class="rounded border border-slate-800 bg-slate-900/50 p-4">
        <div class="text-xs text-slate-500">Total Devices</div>
        <div class="text-xl font-bold text-slate-100 mt-1">1,248</div>
      </div>
      <div class="rounded border border-slate-800 bg-slate-900/50 p-4">
        <div class="text-xs text-slate-500">Activated</div>
        <div class="text-xl font-bold text-teal-400 mt-1">982</div>
      </div>
      <div class="rounded border border-slate-800 bg-slate-900/50 p-4">
        <div class="text-xs text-slate-500">Premium SKU</div>
        <div class="text-xl font-bold text-slate-100 mt-1">1,248</div>
      </div>
      <div class="rounded border border-slate-800 bg-slate-900/50 p-4">
        <div class="text-xs text-slate-500">Resales</div>
        <div class="text-xl font-bold text-slate-100 mt-1">42</div>
      </div>
    </div>

    <div class="rounded-xl border border-slate-800 bg-slate-900/50 overflow-hidden">
      <div class="p-4 border-b border-slate-800">
        <h3 class="text-sm font-semibold text-slate-100">Recent Activations</h3>
      </div>
      <table class="min-w-full text-sm">
        <thead class="bg-slate-900 border-b border-slate-800 text-xs text-slate-400 uppercase">
          <tr>
            <th class="px-4 py-3 text-left">Device ID</th>
            <th class="px-4 py-3 text-left">SKU</th>
            <th class="px-4 py-3 text-left">Region</th>
            <th class="px-4 py-3 text-left">Activated</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-slate-800/50">
          <tr class="hover:bg-slate-800/20">
            <td class="px-4 py-3 font-mono text-xs text-slate-400">0x3F2A...9B12</td>
            <td class="px-4 py-3 text-slate-200">Premium</td>
            <td class="px-4 py-3 text-slate-200">US-EAST</td>
            <td class="px-4 py-3 text-xs text-slate-500">2 mins ago</td>
          </tr>
          <tr class="hover:bg-slate-800/20">
            <td class="px-4 py-3 font-mono text-xs text-slate-400">0x1C8D...4E55</td>
            <td class="px-4 py-3 text-slate-200">Premium</td>
            <td class="px-4 py-3 text-slate-200">EU-WEST</td>
            <td class="px-4 py-3 text-xs text-slate-500">15 mins ago</td>
          </tr>
          <tr class="hover:bg-slate-800/20">
            <td class="px-4 py-3 font-mono text-xs text-slate-400">0xA29B...7F00</td>
            <td class="px-4 py-3 text-slate-200">Premium</td>
            <td class="px-4 py-3 text-slate-200">JP</td>
            <td class="px-4 py-3 text-xs text-slate-500">1 hour ago</td>
          </tr>
        </tbody>
      </table>
    </div>
  `
})
export class DevicesDashboardComponent {}