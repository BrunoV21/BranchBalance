import { AppFailure } from '@/domain/errors';

import type { Clock, Delay, DeviceCode, OAuthTransport, RotatingTokens } from './contracts';

export type DeviceFlowState =
  | { status: 'idle' }
  | { status: 'requesting_code' }
  | { status: 'awaiting_authorization'; userCode: string; verificationUri: string; expiresAt: string; nextPollAt: string }
  | { status: 'exchanging' }
  | { status: 'authorized' }
  | { status: 'denied' }
  | { status: 'expired' }
  | { status: 'cancelled' }
  | { status: 'error'; safeMessage: string; retryable: boolean; userCode?: string; verificationUri?: string; expiresAt?: string };

type ActiveCode = DeviceCode & { expiresAtMs: number; intervalMs: number };

export class DeviceFlowController {
  state: DeviceFlowState = { status: 'idle' };
  private abortController: AbortController | null = null;
  private generation = 0;
  private activeCode: ActiveCode | null = null;

  constructor(
    private readonly transport: Pick<OAuthTransport, 'requestCode' | 'poll'>,
    private readonly clock: Clock,
    private readonly delay: Delay,
    private readonly onState: (state: DeviceFlowState) => void = () => undefined,
  ) {}

  async start(): Promise<RotatingTokens> {
    this.cancel(false);
    const generation = ++this.generation;
    this.abortController = new AbortController();
    const signal = this.abortController.signal;
    this.setState({ status: 'requesting_code' });
    try {
      const code = await this.transport.requestCode(signal);
      this.ensureActive(generation);
      this.activeCode = { ...code, expiresAtMs: this.clock.now().getTime() + code.expiresIn * 1000, intervalMs: code.interval * 1000 };
      return await this.poll(this.activeCode, generation, signal);
    } catch (error) {
      if (signal.aborted || generation !== this.generation) {
        if (this.state.status !== 'cancelled') this.setState({ status: 'cancelled' });
        throw new DOMException('Cancelled', 'AbortError');
      }
      if (this.state.status === 'denied' || this.state.status === 'expired') throw error;
      this.setError(error);
      throw error;
    }
  }

  async retry(): Promise<RotatingTokens> {
    const code = this.activeCode;
    if (!code) return this.start();
    if (this.clock.now().getTime() >= code.expiresAtMs) {
      this.activeCode = null;
      this.setState({ status: 'expired' });
      throw new Error('The GitHub device code expired.');
    }
    this.cancel(false, true);
    const generation = ++this.generation;
    this.abortController = new AbortController();
    const signal = this.abortController.signal;
    try { return await this.poll(code, generation, signal); }
    catch (error) {
      if (signal.aborted || generation !== this.generation) throw new DOMException('Cancelled', 'AbortError');
      if (this.state.status !== 'denied' && this.state.status !== 'expired') this.setError(error);
      throw error;
    }
  }

  cancel(updateState = true, preserveCode = false) {
    if (this.abortController) this.abortController.abort();
    this.abortController = null;
    if (!preserveCode) this.activeCode = null;
    this.generation += 1;
    if (updateState && this.state.status !== 'idle' && this.state.status !== 'authorized') this.setState({ status: 'cancelled' });
  }

  private async poll(code: ActiveCode, generation: number, signal: AbortSignal): Promise<RotatingTokens> {
    while (this.clock.now().getTime() < code.expiresAtMs) {
      const nextPollAt = new Date(this.clock.now().getTime() + code.intervalMs).toISOString();
      this.setState({ status: 'awaiting_authorization', userCode: code.userCode, verificationUri: code.verificationUri, expiresAt: new Date(code.expiresAtMs).toISOString(), nextPollAt });
      await this.delay.wait(code.intervalMs, signal);
      this.ensureActive(generation);
      this.setState({ status: 'exchanging' });
      const result = await this.transport.poll(code.deviceCode, signal);
      this.ensureActive(generation);
      if (result.kind === 'authorized') {
        this.activeCode = null;
        this.setState({ status: 'authorized' });
        return result.tokens;
      }
      if (result.kind === 'denied') {
        this.activeCode = null;
        this.setState({ status: 'denied' });
        throw new Error('GitHub authorization was denied.');
      }
      if (result.kind === 'expired') {
        this.activeCode = null;
        this.setState({ status: 'expired' });
        throw new Error('The GitHub device code expired.');
      }
      if (result.kind === 'slow_down') code.intervalMs += 5000;
    }
    this.activeCode = null;
    this.setState({ status: 'expired' });
    throw new Error('The GitHub device code expired.');
  }

  private ensureActive(generation: number) {
    if (generation !== this.generation || this.abortController?.signal.aborted) throw new DOMException('Cancelled', 'AbortError');
  }

  private setState(state: DeviceFlowState) {
    this.state = state;
    this.onState(state);
  }

  private setError(error: unknown) {
    this.setState({
      status: 'error', safeMessage: error instanceof Error ? error.message : 'Unable to authorize with GitHub.', retryable: retryable(error),
      ...(this.activeCode ? { userCode: this.activeCode.userCode, verificationUri: this.activeCode.verificationUri, expiresAt: new Date(this.activeCode.expiresAtMs).toISOString() } : {}),
    });
  }
}

function retryable(error: unknown) {
  if (!(error instanceof AppFailure)) return true;
  if ('retryable' in error.detail) return error.detail.retryable;
  return false;
}
