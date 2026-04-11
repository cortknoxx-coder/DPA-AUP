
import { Component, inject, effect, viewChild, ElementRef, signal, computed } from '@angular/core';
import { CommonModule, CurrencyPipe, DecimalPipe, PercentPipe } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { UserService } from '../../services/user.service';
import * as d3 from 'd3';
import { DataService } from '../../services/data.service';
import { DeviceConnectionService } from '../../services/device-connection.service';

@Component({
  selector: 'app-user-admin',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, CurrencyPipe, DecimalPipe, PercentPipe],
  templateUrl: './user-admin.component.html',
})
export class UserAdminComponent {
  private fb: FormBuilder = inject(FormBuilder);
  userService = inject(UserService);
  private dataService = inject(DataService);
  connectionService = inject(DeviceConnectionService);

  chartContainer = viewChild<ElementRef>('chartContainer');
  regionChartContainer = viewChild<ElementRef>('regionChartContainer');

  // Forms
  profileForm = this.fb.group({
    name: ['', Validators.required],
    artistName: ['', Validators.required],
    email: ['', [Validators.required, Validators.email]]
  });

  withdrawForm = this.fb.group({
    amount: [0, [Validators.required, Validators.min(10)]],
    methodId: ['', Validators.required]
  });

  addMethodForm = this.fb.group({
    type: ['bank', Validators.required],
    name: ['', Validators.required],
    number: ['', [Validators.required, Validators.minLength(4)]],
    routing: ['']
  });

  // UI State
  showWithdrawModal = signal(false);
  showAddMethodModal = signal(false);

  // Revenue Mix Calculations
  dpaSalesPercent = computed(() => {
    const financials = this.userService.financials();
    if (financials.totalEarnings === 0) return 0;
    return (financials.dpaSalesSource / financials.totalEarnings) * 100;
  });
  royaltyPercent = computed(() => {
    const financials = this.userService.financials();
    if (financials.totalEarnings === 0) return 0;
    return (financials.royaltySource / financials.totalEarnings) * 100;
  });
  perksPercent = computed(() => {
    const financials = this.userService.financials();
    if (financials.totalEarnings === 0) return 0;
    return (financials.perksSource / financials.totalEarnings) * 100;
  });

  // DPAC Operator profit calculation (simulator only)
  totalDpacProfit = computed(() => {
    return this.dataService.albums().reduce((total, album) => {
      if (!album.economics || !album.pricing) return total;
      
      const { totalSold, manufacturingCost, wholesalePrice } = album.economics;
      const { retailPrice } = album.pricing;
      
      if (totalSold > 0) {
        const platformFeePerUnit = retailPrice * 0.15;
        const hardwareMarginPerUnit = wholesalePrice - manufacturingCost;
        const totalProfitPerUnit = platformFeePerUnit + hardwareMarginPerUnit;
        return total + (totalProfitPerUnit * totalSold);
      }
      
      return total;
    }, 0);
  });
  
  // Richer analytics
  totalUnitsSold = computed(() => {
    return this.dataService.albums().reduce((total, album) => total + (album.economics?.totalSold || 0), 0);
  });

  totalResaleTransactions = computed(() => {
    return this.dataService.albums().reduce((total, album) => total + (album.resales?.length || 0), 0);
  });
  
  totalSecondaryVolume = computed(() => {
    return this.dataService.albums().reduce((total, album) => total + (album.economics?.secondaryVolume || 0), 0);
  });

  constructor() {
    effect(() => {
      this.profileForm.setValue(this.userService.userProfile());
    });

    effect(() => {
      const data = this.userService.earningsHistory();
      const element = this.chartContainer()?.nativeElement;
      if (data && element) {
        this.renderHistoryChart(element, data);
      }
    });

    effect(() => {
      const data = this.userService.regionStats();
      const element = this.regionChartContainer()?.nativeElement;
      if (data && element) {
        this.renderRegionChart(element, data);
      }
    });

    effect(() => {
      const defaultMethod = this.userService.paymentMethods().find(m => m.isDefault);
      if (defaultMethod) {
        this.withdrawForm.patchValue({ methodId: defaultMethod.id });
      }
    });
  }

  saveProfile() {
    if (this.profileForm.valid) {
      this.userService.updateProfile(this.profileForm.value as any);
      this.profileForm.markAsPristine();
    }
  }

  initiateWithdraw() {
    this.showWithdrawModal.set(true);
  }

  submitWithdraw() {
    const amount = this.withdrawForm.value.amount || 0;
    const balance = this.userService.financials().currentBalance;

    if (amount > balance) {
      alert('Insufficient funds.');
      return;
    }

    if (this.withdrawForm.valid) {
      this.userService.withdraw(amount);
      this.showWithdrawModal.set(false);
      this.withdrawForm.patchValue({ amount: 0 });
      alert(`Successfully withdrew $${amount} to your account.`);
    }
  }

  submitAddMethod() {
    if (this.addMethodForm.valid) {
      const val = this.addMethodForm.value;
      const last4 = val.number?.slice(-4) || '0000';
      
      this.userService.addPaymentMethod({
        type: val.type as 'bank' | 'card',
        name: val.name || 'Unknown',
        last4: last4,
        isDefault: false
      });
      
      this.showAddMethodModal.set(false);
      this.addMethodForm.reset({ type: 'bank' });
    }
  }

  private renderHistoryChart(container: HTMLElement, data: any[]) {
    d3.select(container).selectAll('*').remove();
    const margin = { top: 20, right: 20, bottom: 30, left: 50 };
    const width = container.clientWidth - margin.left - margin.right;
    const height = container.clientHeight - margin.top - margin.bottom;

    const svg = d3.select(container).append('svg')
      .attr('width', width + margin.left + margin.right)
      .attr('height', height + margin.top + margin.bottom)
      .append('g').attr('transform', `translate(${margin.left},${margin.top})`);

    const defs = svg.append("defs");
    const gradient = defs.append("linearGradient").attr("id", "area-gradient").attr("x1", "0%").attr("y1", "0%").attr("x2", "0%").attr("y2", "100%");
    gradient.append("stop").attr("offset", "0%").attr("stop-color", "#14b8a6").attr("stop-opacity", 0.4);
    gradient.append("stop").attr("offset", "100%").attr("stop-color", "#14b8a6").attr("stop-opacity", 0);

    const x = d3.scaleTime().domain(d3.extent(data, (d: any) => new Date(d.date)) as [Date, Date]).range([0, width]);
    const y = d3.scaleLinear().domain([0, d3.max(data, (d: any) => d.amount) as number * 1.1]).range([height, 0]);

    const area = d3.area<any>().x(d => x(new Date(d.date))).y0(height).y1(d => y(d.amount)).curve(d3.curveMonotoneX);
    const line = d3.line<any>().x(d => x(new Date(d.date))).y(d => y(d.amount)).curve(d3.curveMonotoneX);

    svg.append("path").datum(data).attr("d", area).style("fill", "url(#area-gradient)");
    svg.append("path").datum(data).attr("d", line).style("fill", "none").style("stroke", "#14b8a6").style("stroke-width", 2);

    svg.append("g").attr("transform", `translate(0,${height})`).call(d3.axisBottom(x).ticks(5).tickSize(0).tickPadding(10)).select(".domain").remove();
    svg.append("g").call(d3.axisLeft(y).ticks(5).tickSize(0).tickPadding(10).tickFormat(d => `$${(d as number)/1000}k`)).select(".domain").remove();
    svg.selectAll("g.y-axis g.tick").append("line").attr("x1", 0).attr("x2", width).style("stroke", "#1e293b").style("stroke-dasharray", "4").style("stroke-opacity", 0.5);
  }

  private renderRegionChart(container: HTMLElement, data: any[]) {
    d3.select(container).selectAll('*').remove();
    const width = container.clientWidth;
    const height = container.clientHeight;
    const margin = { top: 0, right: 50, bottom: 0, left: 100 };
    const innerWidth = width - margin.left - margin.right;
    const innerHeight = height - margin.top - margin.bottom;

    const svg = d3.select(container).append('svg')
      .attr('width', width)
      .attr('height', height)
      .append('g').attr('transform', `translate(${margin.left},${margin.top})`);

    const y = d3.scaleBand()
      .domain(data.map(d => d.regionName))
      .range([0, innerHeight])
      .padding(0.4);

    const x = d3.scaleLinear()
      .domain([0, d3.max(data, d => d.revenue) as number])
      .range([0, innerWidth]);

    svg.selectAll('.bar')
      .data(data)
      .enter().append('rect')
      .attr('class', 'bar')
      .attr('y', d => y(d.regionName)!)
      .attr('height', y.bandwidth())
      .attr('x', 0)
      .attr('width', d => x(d.revenue))
      .attr('fill', '#14b8a6') // teal-500
      .attr('rx', 2);

    // Labels (Region Name)
    svg.append('g')
      .attr('class', 'y-axis')
      .call(d3.axisLeft(y).tickSize(0))
      .selectAll('text')
      .attr('fill', '#94a3b8') // slate-400
      .attr('font-size', '12px');
    svg.select('.domain').remove();

    // Value Labels
    svg.selectAll('.label')
      .data(data)
      .enter().append('text')
      .attr('y', d => y(d.regionName)! + y.bandwidth() / 2 + 4)
      .attr('x', d => x(d.revenue) + 8)
      .text(d => '$' + d3.format(",.0f")(d.revenue))
      .attr('fill', '#f8fafc') // slate-50
      .attr('font-size', '11px');
  }
}
