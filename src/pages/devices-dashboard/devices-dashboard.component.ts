
import { Component, inject, computed, signal, viewChild, ElementRef, effect } from '@angular/core';
import { CommonModule, CurrencyPipe, DatePipe, PercentPipe } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { DataService } from '../../services/data.service';
import * as d3 from 'd3';

type Tab = 'overview' | 'resales' | 'economics';

@Component({
  selector: 'app-devices-dashboard',
  standalone: true,
  imports: [CommonModule, CurrencyPipe, DatePipe, PercentPipe],
  templateUrl: './devices-dashboard.component.html'
})
export class DevicesDashboardComponent {
  private route = inject(ActivatedRoute);
  private dataService = inject(DataService);

  private id = computed(() => this.route.parent?.snapshot.params['id']);
  album = computed(() => this.dataService.getAlbum(this.id())());

  activeTab = signal<Tab>('overview');

  // Chart References
  priceHistoryChart = viewChild<ElementRef>('priceHistoryChart');
  
  constructor() {
    effect(() => {
      const a = this.album();
      const tab = this.activeTab();
      const element = this.priceHistoryChart()?.nativeElement;

      // Render chart if on Resales tab and data exists
      if (tab === 'resales' && a?.resales && element) {
        // Small timeout to ensure DOM render
        setTimeout(() => this.renderResaleChart(element, a.resales!), 0);
      }
    });
  }

  setTab(tab: Tab) {
    this.activeTab.set(tab);
  }

  get averageResalePrice() {
    const resales = this.album()?.resales || [];
    if (resales.length === 0) return 0;
    const total = resales.reduce((acc, curr) => acc + curr.priceUsd, 0);
    return total / resales.length;
  }

  get resaleVolume() {
    return this.album()?.economics?.secondaryVolume || 0;
  }

  private renderResaleChart(container: HTMLElement, data: any[]) {
    d3.select(container).selectAll('*').remove();

    // Sort by date ascending for chart
    const sortedData = [...data].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    const margin = { top: 20, right: 20, bottom: 30, left: 40 };
    const width = container.clientWidth - margin.left - margin.right;
    const height = 250 - margin.top - margin.bottom;

    const svg = d3.select(container)
      .append('svg')
      .attr('width', width + margin.left + margin.right)
      .attr('height', height + margin.top + margin.bottom)
      .append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    // Scales
    const x = d3.scaleTime()
      .domain(d3.extent(sortedData, (d: any) => new Date(d.date)) as [Date, Date])
      .range([0, width]);

    const y = d3.scaleLinear()
      .domain([0, d3.max(sortedData, (d: any) => d.priceUsd) * 1.2])
      .range([height, 0]);

    // Line
    const line = d3.line<any>()
      .x(d => x(new Date(d.date)))
      .y(d => y(d.priceUsd))
      .curve(d3.curveMonotoneX);

    // Gradient
    const defs = svg.append("defs");
    const gradient = defs.append("linearGradient")
      .attr("id", "resale-gradient")
      .attr("x1", "0%").attr("y1", "0%")
      .attr("x2", "0%").attr("y2", "100%");
    gradient.append("stop").attr("offset", "0%").attr("stop-color", "#f43f5e").attr("stop-opacity", 0.5); // rose-500
    gradient.append("stop").attr("offset", "100%").attr("stop-color", "#f43f5e").attr("stop-opacity", 0);

    // Area
    const area = d3.area<any>()
      .x(d => x(new Date(d.date)))
      .y0(height)
      .y1(d => y(d.priceUsd))
      .curve(d3.curveMonotoneX);

    svg.append("path")
      .datum(sortedData)
      .attr("class", "area")
      .attr("d", area)
      .style("fill", "url(#resale-gradient)");

    svg.append("path")
      .datum(sortedData)
      .attr("fill", "none")
      .attr("stroke", "#f43f5e")
      .attr("stroke-width", 2)
      .attr("d", line);

    // Axes
    svg.append("g")
      .attr("transform", `translate(0,${height})`)
      .call(d3.axisBottom(x).ticks(5).tickSize(0).tickPadding(10))
      .attr("color", "#64748b")
      .select(".domain").remove();

    svg.append("g")
      .call(d3.axisLeft(y).ticks(5).tickSize(0).tickPadding(10).tickFormat(d => `$${d}`))
      .attr("color", "#64748b")
      .select(".domain").remove();
      
    // Grid
    svg.selectAll("g.y-axis g.tick")
      .append("line")
      .attr("x1", 0).attr("y1", 0)
      .attr("x2", width).attr("y2", 0)
      .style("stroke", "#334155")
      .style("stroke-dasharray", "4")
      .style("stroke-opacity", 0.3);
  }
}
