import 'server-only';
import { Environment, LogLevel, Paddle } from '@paddle/paddle-node-sdk';
import { serverConfig } from '@/server/config/server-config';

/** A Paddle API client for the configured environment. There is no default: sandbox must be chosen explicitly. */
export function getPaddleInstance() {
  const { paddle } = serverConfig();

  return new Paddle(paddle.apiKey, { environment: Environment[paddle.environment], logLevel: LogLevel.error });
}
