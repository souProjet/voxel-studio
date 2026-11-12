import { AudioLines, CircleDot, Orbit, Satellite, type LucideIcon } from 'lucide-react';
import type { SensorKind } from '../../types/voxel';

export const KIND_ICON: Record<SensorKind, LucideIcon> = {
  audio: AudioLines,
  gps: Satellite,
  gpio: CircleDot,
  gyro: Orbit,
};
