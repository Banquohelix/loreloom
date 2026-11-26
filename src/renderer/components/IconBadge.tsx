import React from 'react';
import {
  BookOpen,
  Clock,
  Compass,
  FileText,
  Flame,
  Layers,
  MapPin,
  Rocket,
  Shield,
  Skull,
  Sparkles,
  Sword,
  User,
  Wand2,
} from 'lucide-react';

const ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  'file-text': FileText,
  user: User,
  'map-pin': MapPin,
  shield: Shield,
  sparkles: Sparkles,
  clock: Clock,
  book: BookOpen,
  compass: Compass,
  rocket: Rocket,
  sword: Sword,
  wand: Wand2,
  flame: Flame,
  skull: Skull,
  layers: Layers,
};

export const AVAILABLE_ICON_KEYS = Object.keys(ICON_MAP);

export function EntityIcon({
  name,
  className = 'w-4 h-4',
}: {
  name: string;
  className?: string;
}) {
  const Icon = ICON_MAP[name] ?? FileText;
  return <Icon className={className} />;
}
