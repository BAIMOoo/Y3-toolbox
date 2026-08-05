import { useEffect, useMemo, useSyncExternalStore } from 'react';
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

export function useTechnicalQaController(
  api: QaControllerApi,
  options?: TechnicalQaControllerOptions,
): UseTechnicalQaControllerResult {
  const controller = useMemo(() => createTechnicalQaController(api, options), [api, options]);
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);

  useEffect(() => {
    void controller.initialize();
    return () => controller.dispose();
  }, [controller]);

  return { state, controller };
}
