// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { createElement, StrictMode, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { QaControllerApi } from './controller';
import type { QaQuestionAccepted } from './types';
import { useTechnicalQaController } from './useTechnicalQaController';

describe('useTechnicalQaController', () => {
  it('keeps controller actions live after StrictMode replays the mount effect', async () => {
    const api: QaControllerApi = {
      health: vi.fn().mockResolvedValue({ available: true }),
      submit: vi.fn(),
      events: vi.fn(),
      cancel: vi.fn(),
    };
    const wrapper = ({ children }: { children: ReactNode }) => createElement(StrictMode, null, children);
    const { result } = renderHook(() => useTechnicalQaController(api), { wrapper });
    await act(async () => undefined);

    expect(api.health).toHaveBeenCalledOnce();
    expect(result.current.state.serviceStatus).toBe('ready');
    act(() => result.current.controller.setDraft('Stable composer draft'));
    expect(result.current.state.draft).toBe('Stable composer draft');
  });

  it('disposes the controller after a real unmount and aborts active work', async () => {
    vi.useFakeTimers();
    let submitSignal: AbortSignal | undefined;
    const api: QaControllerApi = {
      health: vi.fn().mockResolvedValue({ available: true }),
      submit: vi.fn((_request, signal): Promise<QaQuestionAccepted> => {
        submitSignal = signal;
        return new Promise<QaQuestionAccepted>((_resolve, reject) => {
          signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
        });
      }),
      events: vi.fn(),
      cancel: vi.fn(),
    };
    const { result, unmount } = renderHook(() => useTechnicalQaController(api));
    await act(async () => undefined);
    act(() => result.current.controller.setDraft('Pending question'));
    act(() => { void result.current.controller.submit(); });

    expect(submitSignal?.aborted).toBe(false);
    unmount();
    await act(async () => { vi.runOnlyPendingTimers(); });

    expect(submitSignal?.aborted).toBe(true);
    vi.useRealTimers();
  });
});
