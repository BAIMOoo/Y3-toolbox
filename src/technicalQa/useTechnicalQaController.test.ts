// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { QaControllerApi } from './controller';
import { useTechnicalQaController } from './useTechnicalQaController';

describe('useTechnicalQaController', () => {
  it('initializes health and exposes stable controller actions', async () => {
    const api: QaControllerApi = {
      health: vi.fn().mockResolvedValue({ available: true }),
      submit: vi.fn(),
      events: vi.fn(),
      cancel: vi.fn(),
    };
    const { result } = renderHook(() => useTechnicalQaController(api));
    await act(async () => undefined);

    expect(api.health).toHaveBeenCalledOnce();
    expect(result.current.state.serviceStatus).toBe('ready');
    act(() => result.current.controller.setDraft('Stable composer draft'));
    expect(result.current.state.draft).toBe('Stable composer draft');
  });
});
