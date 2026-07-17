import { AppFailure } from '@/domain/errors';

import { DeviceFlowController } from './device-flow';

describe('DeviceFlowController', () => {
  it('handles pending and slow-down before authorization', async () => {
    const wait = jest.fn().mockResolvedValue(undefined);
    const poll = jest.fn()
      .mockResolvedValueOnce({ kind: 'pending' })
      .mockResolvedValueOnce({ kind: 'slow_down' })
      .mockResolvedValueOnce({ kind: 'authorized', tokens: {
        accessToken: 'access', accessTokenExpiresIn: 28_800,
        refreshToken: 'refresh', refreshTokenExpiresIn: 15_552_000,
      } });
    const states: string[] = [];
    const controller = new DeviceFlowController({
      requestCode: async () => ({ deviceCode: 'device', userCode: 'ABCD-1234', verificationUri: 'https://github.com/login/device', expiresIn: 900, interval: 5 }),
      poll,
    }, { now: () => new Date('2026-07-16T12:00:00.000Z') }, { wait }, (state) => states.push(state.status));

    await expect(controller.start()).resolves.toMatchObject({ accessToken: 'access' });
    expect(wait.mock.calls.map(([milliseconds]) => milliseconds)).toEqual([5000, 5000, 10000]);
    expect(states).toEqual(expect.arrayContaining(['requesting_code', 'awaiting_authorization', 'authorized']));
  });

  it('cancels and ignores late polling results', async () => {
    let resolvePoll!: (value: { kind: 'pending' }) => void;
    const pollPromise = new Promise<{ kind: 'pending' }>((resolve) => { resolvePoll = resolve; });
    const controller = new DeviceFlowController({
      requestCode: async () => ({ deviceCode: 'device', userCode: 'CODE', verificationUri: 'https://github.com/login/device', expiresIn: 900, interval: 1 }),
      poll: async () => pollPromise,
    }, { now: () => new Date('2026-07-16T12:00:00.000Z') }, { wait: async () => undefined });
    const started = controller.start();
    await Promise.resolve();
    controller.cancel();
    resolvePoll({ kind: 'pending' });
    await expect(started).rejects.toMatchObject({ name: 'AbortError' });
    expect(controller.state.status).toBe('cancelled');
  });

  it('retries polling with the same unexpired device code after a network error', async () => {
    const requestCode = jest.fn().mockResolvedValue({ deviceCode: 'device', userCode: 'SAME-CODE', verificationUri: 'https://github.com/login/device', expiresIn: 900, interval: 1 });
    const poll = jest.fn().mockRejectedValueOnce(new Error('Offline')).mockResolvedValueOnce({ kind: 'authorized', tokens: { accessToken: 'a', accessTokenExpiresIn: 100, refreshToken: 'r', refreshTokenExpiresIn: 1000 } });
    const controller = new DeviceFlowController({ requestCode, poll }, { now: () => new Date('2026-07-16T12:00:00.000Z') }, { wait: async () => undefined });
    await expect(controller.start()).rejects.toThrow('Offline');
    expect(controller.state).toMatchObject({ status: 'error', userCode: 'SAME-CODE' });
    await expect(controller.retry()).resolves.toMatchObject({ accessToken: 'a' });
    expect(requestCode).toHaveBeenCalledTimes(1);
  });

  it('preserves a terminal transport error as non-retryable', async () => {
    const controller = new DeviceFlowController({
      requestCode: async () => { throw new AppFailure({ kind: 'github', status: 400, safeMessage: 'Enable Device Flow in the GitHub App settings, then try again.', retryable: false }); },
      poll: jest.fn(),
    }, { now: () => new Date('2026-07-16T12:00:00.000Z') }, { wait: async () => undefined });

    await expect(controller.start()).rejects.toThrow('Enable Device Flow');
    expect(controller.state).toEqual({
      status: 'error',
      safeMessage: 'Enable Device Flow in the GitHub App settings, then try again.',
      retryable: false,
    });
  });
});
