import { Component, inject, effect, viewChild, ElementRef } from '@angular/core';
import { CommonModule, CurrencyPipe } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { UserService } from '../../services/user.service';
import * as d3 from 'd3';

@Component({
  selector: 'app-user-admin',
  imports: [CommonModule, ReactiveFormsModule, CurrencyPipe],
  templateUrl: './user-admin.component.html',
})
export class UserAdminComponent {
  private fb = inject(FormBuilder);
  userService = inject(UserService);

  chartContainer = viewChild<ElementRef>('chartContainer');

  profileForm = this.fb.group({
    name: ['', Validators.required],
    artistName: ['', Validators.required],
    email: ['', [Validators.required, Validators.email]]
  });

  constructor() {
    effect(() => {
      // When user data is loaded, patch the form.
      this.profileForm.setValue(this.userService.userProfile());
    });

    effect(() => {
      const data = this.userService.earningsHistory();
      const element = this.chartContainer()?.nativeElement;
      if (data && element) {
        this.renderChart(element, data);
      }
    });
  }

  save() {
    if (this.profileForm.valid) {
      this.userService.updateProfile(this.profileForm.value as any);
      this.profileForm.markAsPristine();
    }
  }

  private renderChart(container: HTMLElement, data: any[]) {
    // Clear previous chart
    d3.select(container).selectAll('*').remove();

    const margin = { top: 20, right: 20, bottom: 30, left: 50 };
    const width = container.clientWidth - margin.left - margin.right;
    const height = container.clientHeight - margin.top - margin.bottom;

    const svg = d3.select(container)
      .append('svg')
      .attr('width', width + margin.left + margin.right)
      .attr('height', height + margin.top + margin.bottom)
      .append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    // Definitions for gradient
    const defs = svg.append("defs");
    const gradient = defs.append("linearGradient")
      .attr("id", "area-gradient")
      .attr("x1", "0%")
      .attr("y1", "0%")
      .attr("x2", "0%")
      .attr("y2", "100%");

    gradient.append("stop")
      .attr("offset", "0%")
      .attr("stop-color", "#14b8a6") // teal-500
      .attr("stop-opacity", 0.4);

    gradient.append("stop")
      .attr("offset", "100%")
      .attr("stop-color", "#14b8a6")
      .attr("stop-opacity", 0);

    // X Scale
    const x = d3.scaleTime()
      .domain(d3.extent(data, (d: any) => new Date(d.date)) as [Date, Date])
      .range([0, width]);

    // Y Scale
    const y = d3.scaleLinear()
      .domain([0, d3.max(data, (d: any) => d.amount) as number * 1.1])
      .range([height, 0]);

    // Area Generator
    const area = d3.area<any>()
      .x(d => x(new Date(d.date)))
      .y0(height)
      .y1(d => y(d.amount))
      .curve(d3.curveMonotoneX);

    // Line Generator
    const line = d3.line<any>()
      .x(d => x(new Date(d.date)))
      .y(d => y(d.amount))
      .curve(d3.curveMonotoneX);

    // Draw Area
    svg.append("path")
      .datum(data)
      .attr("class", "area")
      .attr("d", area)
      .style("fill", "url(#area-gradient)");

    // Draw Line
    svg.append("path")
      .datum(data)
      .attr("class", "line")
      .attr("d", line)
      .style("fill", "none")
      .style("stroke", "#14b8a6")
      .style("stroke-width", 2);

    // X Axis
    svg.append("g")
      .attr("transform", `translate(0,${height})`)
      .call(d3.axisBottom(x).ticks(5).tickSize(0).tickPadding(10))
      .attr("color", "#475569") // slate-600
      .select(".domain").remove();

    // Y Axis
    svg.append("g")
      .call(d3.axisLeft(y).ticks(5).tickSize(0).tickPadding(10).tickFormat(d => `$${d}`))
      .attr("color", "#475569")
      .select(".domain").remove();

    // Add Gridlines
    svg.selectAll("g.y-axis g.tick")
      .append("line")
      .attr("class", "gridline")
      .attr("x1", 0)
      .attr("y1", 0)
      .attr("x2", width)
      .attr("y2", 0)
      .style("stroke", "#1e293b") // slate-800
      .style("stroke-dasharray", "4")
      .style("stroke-opacity", 0.5);
  }
}
