import { afterEach, describe, expect, it, vi } from 'vitest';
import { register } from './instrumentation';

const config = vi.hoisted(() => ({ serverConfig: vi.fn() }));
vi.mock('@/server/config/server-config', () => config);

describe('register', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    config.serverConfig.mockReset();
  });

  it('validates the configuration when a Node.js server starts, and fails with it', async () => {
    vi.stubEnv('NEXT_RUNTIME', 'nodejs');
    config.serverConfig.mockImplementation(() => {
      throw new Error('The server configuration is invalid');
    });

    await expect(register()).rejects.toThrow('The server configuration is invalid');
  });

  it('does not validate in the edge runtime or during the build', async () => {
    vi.stubEnv('NEXT_RUNTIME', 'edge');
    await register();

    vi.stubEnv('NEXT_RUNTIME', 'nodejs');
    vi.stubEnv('NEXT_PHASE', 'phase-production-build');
    await register();

    expect(config.serverConfig).not.toHaveBeenCalled();
  });
});
