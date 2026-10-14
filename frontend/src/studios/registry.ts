import type { ComponentType } from 'react';
import type { StudioId } from '../store/project';

export type StudioStatus = 'working' | 'partial' | 'coming_soon';

/** Every studio exposes the same four regions of the shared workspace shell. */
export interface StudioModule {
  Left: ComponentType;
  Center: ComponentType;
  Right: ComponentType;
  Bottom: ComponentType;
}

export interface StudioDef {
  id: StudioId;
  labelKey: string;
  abbr: string;
  status: StudioStatus;
  /** Lazy-loaded so studios that are not open do not cost bundle time. */
  load?: () => Promise<{ default: StudioModule }>;
}

export const WORKSPACE_STUDIOS: StudioDef[] = [
  { id: '3d', labelKey: 'nav.3d', abbr: '3D', status: 'working', load: () => import('./ThreeDStudio') },
  { id: 'ai-lab', labelKey: 'nav.ai_lab', abbr: 'AI', status: 'partial', load: () => import('./AILabStudio') },
  { id: '2d', labelKey: 'nav.2d', abbr: '2D', status: 'coming_soon' },
  { id: 'character', labelKey: 'nav.character', abbr: 'CH', status: 'coming_soon' },
  { id: 'animation', labelKey: 'nav.animation', abbr: 'AN', status: 'coming_soon' },
  { id: 'cinema', labelKey: 'nav.cinema', abbr: 'CI', status: 'coming_soon' },
  { id: 'audio-vfx', labelKey: 'nav.audio_vfx', abbr: 'AU', status: 'coming_soon' },
  { id: 'story', labelKey: 'nav.story', abbr: 'ST', status: 'coming_soon' },
];

export function studioDef(id: string): StudioDef | undefined {
  return WORKSPACE_STUDIOS.find((s) => s.id === id);
}
