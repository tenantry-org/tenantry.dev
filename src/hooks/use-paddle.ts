import { initializePaddle, type InitializePaddleOptions, type Paddle } from '@paddle/paddle-js';
import { useEffect, useRef, useState } from 'react';
import { publicConfig } from '@/lib/public-config';

/** The Paddle.js settings a page chooses; the client token and environment come from the public configuration. */
export type PaddleSettings = Pick<InitializePaddleOptions, 'eventCallback' | 'checkout'>;

export type PaddleState = { status: 'loading' } | { status: 'ready'; paddle: Paddle } | { status: 'failed' };

/**
 * Loads Paddle.js and initialises it for this environment when the component mounts. `settings` is called then, in
 * the browser, so it can use `window`; later renders do not re-initialise, and neither does a page shown again after
 * navigating back (Next.js keeps it in an Activity and re-runs its effects). The state is 'failed' when Paddle.js
 * does not load, for example when a content blocker stops its script, so the page can say so instead of waiting.
 */
export function usePaddle(settings: () => PaddleSettings = () => ({})): PaddleState {
  const [state, setState] = useState<PaddleState>({ status: 'loading' });
  const initialSettings = useRef(settings);
  const loaded = useRef(false);

  useEffect(() => {
    if (loaded.current) return;
    let current = true;

    void loadPaddle(initialSettings.current).then((result) => {
      if (!current) return;
      loaded.current = true;
      setState(result);
    });

    return () => {
      current = false;
    };
  }, []);

  return state;
}

/**
 * Loads and initialises Paddle.js: 'ready' with it, or 'failed', logged, when it does not load. Never throws. Paddle.js
 * catches a failed setup itself and still returns the instance, so `Initialized` decides; it is set once setup
 * starts, so a client token Paddle refuses shows only when the checkout or the price preview calls Paddle.
 */
export async function loadPaddle(
  settings: () => PaddleSettings,
  initialize: typeof initializePaddle = initializePaddle,
): Promise<PaddleState> {
  try {
    const { clientToken, environment } = publicConfig().paddle;
    const paddle = await initialize({ ...settings(), token: clientToken, environment });
    if (paddle?.Initialized) return { status: 'ready', paddle };

    console.error('Paddle.js could not be loaded.');
  } catch (error) {
    console.error('Paddle.js could not be loaded:', error);
  }

  return { status: 'failed' };
}
