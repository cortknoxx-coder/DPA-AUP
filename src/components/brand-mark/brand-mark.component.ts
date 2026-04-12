import { Component, computed, input } from '@angular/core';

type BrandMarkSize = 'hero' | 'nav' | 'compact' | 'micro';
type BrandMarkTone = 'teal' | 'indigo' | 'slate';

@Component({
  selector: 'app-brand-mark',
  standalone: true,
  template: `
    <span [class]="shellClasses()">
      <span class="flex min-w-0 flex-col items-center justify-center text-center leading-none">
        <span class="flex items-start gap-[0.18em]">
          <span [class]="wordClasses()">DPA</span>
          <span [class]="tmClasses()">TM</span>
        </span>
        @if (descriptor()) {
          <span class="mt-1 flex items-center justify-center gap-2">
            <span [class]="ruleClasses()"></span>
            <span [class]="descriptorClasses()">{{ descriptor() }}</span>
          </span>
        }
      </span>
      @if (suffix()) {
        <span [class]="suffixClasses()">{{ suffix() }}</span>
      }
    </span>
  `,
})
export class BrandMarkComponent {
  size = input<BrandMarkSize>('nav');
  tone = input<BrandMarkTone>('slate');
  descriptor = input('DIGITAL PLAYBACK ASSET');
  suffix = input('');
  framed = input(true);

  private sizeConfig = computed(() => {
    switch (this.size()) {
      case 'hero':
        return {
          shell: 'gap-4 rounded-[1.65rem] px-6 py-4',
          word: 'text-4xl sm:text-5xl tracking-[0.34em]',
          tm: 'pt-1 text-[10px] sm:text-xs tracking-[0.28em]',
          descriptor: 'text-[9px] sm:text-[10px] tracking-[0.42em]',
          rule: 'h-px w-8 sm:w-10',
          suffix: 'px-3 py-1.5 text-[10px] sm:text-xs tracking-[0.34em]',
        };
      case 'compact':
        return {
          shell: 'gap-3 rounded-xl px-3 py-2',
          word: 'text-sm tracking-[0.3em]',
          tm: 'pt-px text-[7px] tracking-[0.22em]',
          descriptor: 'text-[7px] tracking-[0.34em]',
          rule: 'h-px w-4',
          suffix: 'px-2 py-1 text-[8px] tracking-[0.28em]',
        };
      case 'micro':
        return {
          shell: 'gap-1.5 px-0 py-0',
          word: 'text-[11px] tracking-[0.26em]',
          tm: 'pt-px text-[6px] tracking-[0.18em]',
          descriptor: 'text-[5px] tracking-[0.3em]',
          rule: 'h-px w-3',
          suffix: 'px-1.5 py-0.5 text-[6px] tracking-[0.24em]',
        };
      default:
        return {
          shell: 'gap-3 rounded-2xl px-4 py-2.5',
          word: 'text-lg tracking-[0.32em]',
          tm: 'pt-px text-[8px] tracking-[0.24em]',
          descriptor: 'text-[8px] tracking-[0.38em]',
          rule: 'h-px w-5',
          suffix: 'px-2.5 py-1 text-[9px] tracking-[0.3em]',
        };
    }
  });

  private toneConfig = computed(() => {
    switch (this.tone()) {
      case 'teal':
        return {
          shell: 'border-teal-500/20 bg-slate-950/70 shadow-[0_0_30px_rgba(20,184,166,0.14)]',
          word: 'text-white',
          tm: 'text-teal-300/90',
          descriptor: 'text-teal-200/75',
          rule: 'bg-gradient-to-r from-teal-400 via-cyan-300 to-transparent',
          suffix: 'border-teal-400/20 bg-teal-500/10 text-teal-200/90',
        };
      case 'indigo':
        return {
          shell: 'border-indigo-500/20 bg-slate-950/70 shadow-[0_0_30px_rgba(99,102,241,0.14)]',
          word: 'text-white',
          tm: 'text-indigo-200/90',
          descriptor: 'text-indigo-100/75',
          rule: 'bg-gradient-to-r from-indigo-400 via-sky-300 to-transparent',
          suffix: 'border-indigo-400/20 bg-indigo-500/10 text-indigo-100/90',
        };
      default:
        return {
          shell: 'border-white/10 bg-white/[0.03] shadow-[0_0_20px_rgba(255,255,255,0.05)]',
          word: 'text-slate-100',
          tm: 'text-slate-400',
          descriptor: 'text-slate-500',
          rule: 'bg-gradient-to-r from-slate-300/70 to-transparent',
          suffix: 'border-white/10 bg-white/[0.04] text-slate-300/90',
        };
    }
  });

  shellClasses = computed(() => {
    const size = this.sizeConfig();
    const tone = this.toneConfig();
    const frame = this.framed() ? `${tone.shell} border` : 'border-transparent bg-transparent shadow-none';
    return `inline-flex items-center justify-center leading-none select-none ${size.shell} ${frame}`;
  });

  wordClasses = computed(() => {
    const size = this.sizeConfig();
    const tone = this.toneConfig();
    return `font-black uppercase ${size.word} ${tone.word}`;
  });

  tmClasses = computed(() => {
    const size = this.sizeConfig();
    const tone = this.toneConfig();
    return `font-semibold uppercase ${size.tm} ${tone.tm}`;
  });

  descriptorClasses = computed(() => {
    const size = this.sizeConfig();
    const tone = this.toneConfig();
    return `font-semibold uppercase ${size.descriptor} ${tone.descriptor}`;
  });

  ruleClasses = computed(() => {
    const size = this.sizeConfig();
    const tone = this.toneConfig();
    return `${size.rule} rounded-full ${tone.rule}`;
  });

  suffixClasses = computed(() => {
    const size = this.sizeConfig();
    const tone = this.toneConfig();
    return `rounded-full border font-semibold uppercase ${size.suffix} ${tone.suffix}`;
  });
}
