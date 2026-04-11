import { LedPattern } from '../types';

export type LedPatternOption = { value: LedPattern; label: string };
export type LedPatternGroup = { label: string; options: LedPatternOption[] };

/** Must match firmware `led.h` pattern strings and device dashboard ordering. */
export const FIRMWARE_LED_PATTERN_GROUPS: LedPatternGroup[] = [
  {
    label: 'Basic',
    options: [
      { value: 'breathing', label: 'Breathing' },
      { value: 'solid', label: 'Solid' },
      { value: 'pulse', label: 'Pulse' },
      { value: 'off', label: 'Off' },
    ],
  },
  {
    label: 'Animated',
    options: [
      { value: 'rainbow', label: 'Rainbow Flow' },
      { value: 'comet', label: 'Comet' },
      { value: 'wave', label: 'Wave' },
      { value: 'sparkle', label: 'Sparkle' },
      { value: 'fire', label: 'Fire' },
      { value: 'dual_comet', label: 'Dual Comet' },
      { value: 'meteor', label: 'Meteor Rain' },
      { value: 'theater', label: 'Theater Chase' },
      { value: 'bounce', label: 'Bounce' },
    ],
  },
  {
    label: 'Audio-Reactive',
    options: [
      { value: 'audio_pulse', label: 'Audio Pulse' },
      { value: 'audio_bass', label: 'Bass Flash' },
      { value: 'audio_beat', label: 'Beat Strobe' },
      { value: 'audio_comet', label: 'Audio Comet' },
      { value: 'audio_vu', label: 'Audio VU' },
    ],
  },
  {
    label: 'VU Meter',
    options: [
      { value: 'vu_classic', label: 'VU Classic' },
      { value: 'vu_fill', label: 'VU Fill' },
      { value: 'vu_peak', label: 'VU Peak Hold' },
      { value: 'vu_split', label: 'VU Stereo Split' },
      { value: 'vu_bass', label: 'VU Bass' },
      { value: 'vu_energy', label: 'VU Energy' },
    ],
  },
  {
    label: 'Notification',
    options: [
      { value: 'chase_fwd', label: 'Chase Forward' },
      { value: 'chase_rev', label: 'Chase Reverse' },
      { value: 'heartbeat', label: 'Heartbeat' },
      { value: 'fade_out', label: 'Fade Out' },
    ],
  },
];
