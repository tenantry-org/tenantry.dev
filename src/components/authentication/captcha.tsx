'use client';

import { type ReactNode, useEffect, useRef, useState } from 'react';
import { publicConfig } from '@/lib/public-config';

// Cloudflare Turnstile's browser API (https://developers.cloudflare.com/turnstile/get-started/client-side-rendering/),
// as much of it as the forms use.
interface Turnstile {
  render(
    container: HTMLElement,
    options: {
      sitekey: string;
      callback: (token: string) => void;
      'expired-callback': () => void;
      'error-callback': () => void;
      theme: 'dark';
      appearance: 'interaction-only';
      size: 'flexible';
    },
  ): string;
  reset(widgetId: string): void;
  remove(widgetId: string): void;
}

declare global {
  interface Window {
    turnstile?: Turnstile;
  }
}

const SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

let loading: Promise<Turnstile> | undefined;

// Loads Turnstile's script once for the page, however many forms ask for it.
function loadTurnstile(): Promise<Turnstile> {
  loading ??= new Promise<Turnstile>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = SCRIPT_URL;
    script.async = true;
    script.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error('Turnstile did not start')));
    script.onerror = () => {
      loading = undefined;
      script.remove();
      reject(new Error('Turnstile could not be loaded'));
    };
    document.head.appendChild(script);
  });
  return loading;
}

export interface CaptchaState {
  /** Whether this build checks for scripts: NEXT_PUBLIC_TURNSTILE_SITE_KEY is set. */
  required: boolean;
  /** The token to send with the form, or null while there is none (or none is needed). */
  token: string | null;
  /** Gets a new token, since Supabase accepts each one once: call it after a submission that failed. */
  reset: () => void;
}

/**
 * The check that tells people from scripts on the sign-up, log-in and password reset forms (Cloudflare Turnstile). It
 * shows only when Turnstile wants the visitor to do something; otherwise it passes on its own. Without a site key it
 * renders nothing and the form sends no token.
 */
export function useCaptcha(): CaptchaState & { element: ReactNode } {
  const siteKey = publicConfig().turnstileSiteKey;
  const container = useRef<HTMLDivElement>(null);
  const widget = useRef<{ turnstile: Turnstile; id: string } | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!siteKey) return;
    let current = true;

    loadTurnstile().then(
      (turnstile) => {
        if (!current || !container.current) return;
        const id = turnstile.render(container.current, {
          sitekey: siteKey,
          callback: (value) => {
            setFailed(false);
            setToken(value);
          },
          'expired-callback': () => setToken(null),
          'error-callback': () => {
            setToken(null);
            setFailed(true);
          },
          theme: 'dark',
          appearance: 'interaction-only',
          size: 'flexible',
        });
        widget.current = { turnstile, id };
      },
      (error) => {
        console.error(error);
        if (current) setFailed(true);
      },
    );

    return () => {
      current = false;
      if (widget.current) widget.current.turnstile.remove(widget.current.id);
      widget.current = null;
    };
  }, [siteKey]);

  const reset = () => {
    if (!widget.current) return;
    setToken(null);
    widget.current.turnstile.reset(widget.current.id);
  };

  const element = siteKey ? (
    <div className={'flex flex-col gap-2'}>
      <div ref={container} />
      {failed && (
        <p className={'text-sm text-destructive'}>
          The check that keeps out scripts could not run. Reload the page, or allow challenges.cloudflare.com if a
          content blocker stops it.
        </p>
      )}
    </div>
  ) : null;

  return { required: Boolean(siteKey), token, reset, element };
}
