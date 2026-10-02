import 'server-only';
import { Environment, LogLevel, Paddle, PaddleOptions } from '@paddle/paddle-node-sdk';
import { requireEnv } from '@/server/config/env';

/** A Paddle API client for the configured environment. There is no default: sandbox must be chosen explicitly. */
export function getPaddleInstance() {
  const environment = requireEnv('NEXT_PUBLIC_PADDLE_ENV');
  if (environment !== Environment.sandbox && environment !== Environment.production) {
    throw new Error(`NEXT_PUBLIC_PADDLE_ENV must be "sandbox" or "production" (it is "${environment}").`);
  }

  const paddleOptions: PaddleOptions = { environment, logLevel: LogLevel.error };

  return new Paddle(requireEnv('PADDLE_API_KEY'), paddleOptions);
}
