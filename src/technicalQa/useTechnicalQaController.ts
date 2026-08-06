import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import {
  createTechnicalQaController,
  type QaControllerApi,
  type TechnicalQaController,
  type TechnicalQaControllerOptions,
  type TechnicalQaState,
} from './controller';

export interface UseTechnicalQaControllerResult {
  state: TechnicalQaState;
  controller: TechnicalQaController;
}

interface PendingControllerDispose {
  controller: TechnicalQaController;
  timer: ReturnType<typeof globalThis.setTimeout>;
}

export function useTechnicalQaController(
  api: QaControllerApi,
  options?: TechnicalQaControllerOptions,
): UseTechnicalQaControllerResult {
  const controller = useMemo(() => createTechnicalQaController(api, options), [api, options]);
  const pendingDisposeRef = useRef<PendingControllerDispose | undefined>(undefined);
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);

  useEffect(() => {
    const pendingDispose = pendingDisposeRef.current;
    if (pendingDispose) {
      globalThis.clearTimeout(pendingDispose.timer);
      if (pendingDispose.controller !== controller) pendingDispose.controller.dispose();
      pendingDisposeRef.current = undefined;
    }

    void controller.initialize();
    return () => {
      const timer = globalThis.setTimeout(() => {
        if (pendingDisposeRef.current?.controller !== controller) return;
        pendingDisposeRef.current = undefined;
        controller.dispose();
      }, 0);
      pendingDisposeRef.current = { controller, timer };
    };
  }, [controller]);

  return { state, controller };
}
