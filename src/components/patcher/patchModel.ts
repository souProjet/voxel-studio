import { Piano, RadioReceiver, SlidersVertical, TrendingUp, Waves, type LucideIcon } from 'lucide-react';
import type { ChannelKey, Generator, GeneratorKind, ModTarget, SensorChannel, SensorNode } from '../../types/voxel';
import { KIND_META, TARGET_META } from '../../services/catalog';
import type { ChannelValues } from '../../services/shaderMath';
import { sensorIdOf } from '../../services/sensors';
import { GENERATOR_META } from '../../services/generators';
import { t } from '../../i18n';

export const TARGETS = Object.keys(TARGET_META) as ModTarget[];

export const GEN_ICON: Record<GeneratorKind, LucideIcon> = { lfo: Waves, envelope: TrendingUp, macro: SlidersVertical, osc: RadioReceiver, midi: Piano };

/** Everything the patcher needs to resolve a channel key to a label, a color and a value. */
export interface Patch {
  channels: SensorChannel[];
  byKey: Map<ChannelKey, SensorChannel>;
  sensors: Map<string, SensorNode>;
  gens: Map<string, Generator>;
  values: ChannelValues;
}

export const colorOf = (p: Patch, key: ChannelKey) => {
  const sensor = p.sensors.get(sensorIdOf(key));
  if (sensor) return KIND_META[sensor.kind].color;
  const gen = p.gens.get(sensorIdOf(key));
  return gen ? GENERATOR_META[gen.kind].color : '#52525b';
};

export const labelOf = (p: Patch, key: ChannelKey) => {
  const c = p.byKey.get(key);
  const sensor = p.sensors.get(sensorIdOf(key));
  if (c && sensor) return `${sensor.name} · ${t(c.label)}`;
  const gen = p.gens.get(sensorIdOf(key));
  return gen ? gen.name : t('Missing channel');
};

/** Sensor channel labels are catalog text; generator channels carry the user's name. */
export const chLabel = (p: Patch, ch: SensorChannel) => (p.sensors.has(ch.sensorId) ? t(ch.label) : ch.label);
