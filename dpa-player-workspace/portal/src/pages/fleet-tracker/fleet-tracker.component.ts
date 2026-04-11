
import { Component, inject, viewChild, ElementRef, effect, OnDestroy, signal } from '@angular/core';
import { CommonModule, CurrencyPipe, DecimalPipe } from '@angular/common';
import * as d3 from 'd3';
import { geoPath, geoMercator } from 'd3-geo';
import { FeatureCollection } from 'geojson';
import { FleetService, ActivityEvent } from '../../services/fleet.service';
import { Subscription } from 'rxjs';

@Component({
  selector: 'app-fleet-tracker',
  standalone: true,
  imports: [CommonModule, CurrencyPipe, DecimalPipe],
  templateUrl: './fleet-tracker.component.html',
})
export class FleetTrackerComponent implements OnDestroy {
  fleetService = inject(FleetService);
  mapContainer = viewChild<ElementRef>('mapContainer');

  kpis = this.fleetService.getKpis();
  topRegions = this.fleetService.getTopRegions();
  
  activityStream = signal<ActivityEvent[]>([]);
  private activitySub: Subscription;
  
  // World map GeoJSON (simplified version)
  private worldGeoJson: FeatureCollection = {
    "type": "FeatureCollection",
    "features": [
      { "type": "Feature", "properties": { "name": "World" }, "geometry": { "type": "Polygon", "coordinates": [ [ [-180, 90], [180, 90], [180, -90], [-180, -90], [-180, 90] ] ] } },
      // In a real app, this would be a full world map GeoJSON object.
      // For this demo, a simple outline and d3's built-in graticule will suffice.
    ]
  };

  constructor() {
    effect(() => {
      const el = this.mapContainer()?.nativeElement;
      const data = this.fleetService.getActivations();
      if (el && data().length > 0) {
        this.renderMap(el, this.worldGeoJson, data());
      }
    });

    this.activitySub = this.fleetService.getActivityStream().subscribe(event => {
      this.activityStream.update(current => [event, ...current.slice(0, 19)]);
    });
  }

  ngOnDestroy() {
    this.activitySub.unsubscribe();
  }

  private renderMap(container: HTMLElement, world: FeatureCollection, activations: any[]) {
    d3.select(container).selectAll('*').remove();
    const width = container.clientWidth;
    const height = container.clientHeight;

    const projection = geoMercator()
      .scale(width / 2 / Math.PI)
      .translate([width / 2, height / 2]);

    const path = geoPath().projection(projection);

    const svg = d3.select(container).append('svg')
      .attr('width', width)
      .attr('height', height)
      .style('background-color', '#0f172a'); // slate-900

    // Graticule (map lines)
    svg.append('path')
      .datum(d3.geoGraticule10())
      .attr('d', path)
      .attr('stroke', '#1e293b') // slate-800
      .attr('stroke-width', 0.5)
      .attr('fill', 'none');

    // Land
    svg.append('path')
      .datum(d3.geoGraticule().outline)
      .attr('d', path)
      .attr('fill', '#1e293b'); // slate-800

    // Data points
    const circles = svg.selectAll('circle')
      .data(activations)
      .enter()
      .append('circle')
      .attr('cx', d => projection([d.lon, d.lat])![0])
      .attr('cy', d => projection([d.lon, d.lat])![1])
      .attr('r', d => 2 + d.activity * 3)
      .attr('fill', '#2dd4bf') // teal-400
      .attr('fill-opacity', 0.4)
      .attr('stroke', '#2dd4bf')
      .attr('stroke-width', 1)
      .attr('stroke-opacity', 0.8);

    // Animate the circles
    circles.append('animate')
      .attr('attributeName', 'r')
      .attr('values', d => `${2 + d.activity * 3}; ${2 + d.activity * 6}; ${2 + d.activity * 3}`)
      .attr('dur', '2s')
      .attr('repeatCount', 'indefinite');
    
    circles.append('animate')
      .attr('attributeName', 'fill-opacity')
      .attr('values', '0.4;0.8;0.4')
      .attr('dur', '2s')
      .attr('repeatCount', 'indefinite');
  }

  getIconForEvent(type: ActivityEvent['type']): string {
    switch (type) {
      case 'PLAY': return '▶';
      case 'SALE': return '🛒';
      case 'ROYALTY': return '💰';
      case 'ACTIVATION': return '🛰️';
      default: return '•';
    }
  }
}
