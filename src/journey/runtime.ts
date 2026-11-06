import { useMemo, useState } from 'react';

export type JourneyPhase = 'loading' | 'portrait' | 'playing' | 'paused' | 'free' | 'error';
export type JourneyParameters = {
  spread: number; dissolve: number; reveal: number; colorMix: number; galleryMix: number; opacity: number;
};
export type JourneyRuntime = {
  phase: JourneyPhase;
  parameters: JourneyParameters;
  timeline: gsap.core.Timeline | null;
  overlay: HTMLDivElement | null;
  ready: boolean;
  handoff: number;
  error: string;
  notify: (phase: JourneyPhase) => void;
  api: null | { start: () => void; pause: () => void; resume: () => void; reset: () => void; skip: () => void };
};
function initialPhase(): JourneyPhase {
  const params = new URLSearchParams(location.search);
  if (params.get('intro') === '1') return 'loading';
  if (params.get('intro') === '0') return 'free';
  if (location.hash.includes('obra=') || location.hash.includes('foto=') || location.hash.includes('vista=')) return 'free';
  // The portrait is the front door on every fresh visit. The film only plays
  // after a click, and Skip remains available for direct access to the gallery.
  return 'loading';
}

export function useJourney() {
  'use no memo';
  const [initial] = useState(initialPhase);
  const [phase, setPhase] = useState<JourneyPhase>(initial);
  const runtime = useMemo<JourneyRuntime>(() => {
    const value: JourneyRuntime = {
      phase: initial,
      parameters: {spread: initial === 'free' ? 1 : 0, dissolve: initial === 'free' ? 1 : 0, reveal: initial === 'free' ? 1 : 0, colorMix: .82, galleryMix: initial === 'free' ? 1 : 0, opacity: initial === 'free' ? 0 : 1},
      timeline: null, overlay: null, ready: false, handoff: 0, error: '', api: null,
      notify(next) {
        value.phase = next;
        setPhase(next);
      },
    };
    return value;
  }, [initial]);
  return {
    runtime, phase,
    start: () => runtime.api?.start(),
    pause: () => runtime.api?.pause(),
    resume: () => runtime.api?.resume(),
    portrait: () => { if (runtime.api) runtime.api.reset(); else runtime.notify('loading'); },
    skip: () => {
      if (runtime.api) runtime.api.skip();
      else {
        Object.assign(runtime.parameters, {spread: 1, dissolve: 1, reveal: 1, colorMix: 0, galleryMix: 1, opacity: 0});
        runtime.handoff++;
        runtime.notify('free');
      }
    },
  };
}

export type JourneyControls = ReturnType<typeof useJourney>;
