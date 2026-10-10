import { withBreaker } from '../core/breaker';
import { JEV_MODEL, liveEvaluate } from '../core/jev';
import { type Decide, typedDecide } from '../core/run';
import { log } from './log';
import { breakerState } from './metrics';

/**
 * Everything the service reads from its environment, validated once at startup.
 * A bad value fails the boot, so a broken config never takes traffic.
 */

/** `jev` (the pinned model) or `jev:<model id>`, e.g. `jev:jev-latest`. */
export function decider(spec: string, apiKey?: string): { model: string; decide: Decide } {
  const [kind, model = JEV_MODEL] = spec.split(':');
  if (kind !== 'jev') throw new Error(`Unknown decider "${spec}": use jev or jev:<model>`);
  breakerState.set({ model }, 0);
  const decide = withBreaker(typedDecide(liveEvaluate(model, apiKey)), {
    onState: (state) => {
      breakerState.set({ model }, state === 'open' ? 1 : state === 'half-open' ? 0.5 : 0);
      log(state === 'open' ? 'warn' : 'info', 'breaker', { model, state });
    },
  });
  return { model, decide };
}

export function loadConfig(env: Record<string, string | undefined> = process.env) {
  const port = Number(env.PORT ?? 8080);
  if (!Number.isInteger(port) || port <= 0)
    throw new Error(`PORT must be a port number, got ${env.PORT}`);
  const shadowSample = Number(env.INTAKE_SHADOW_SAMPLE ?? 1);
  if (!(shadowSample >= 0 && shadowSample <= 1)) {
    throw new Error(
      `INTAKE_SHADOW_SAMPLE must be between 0 and 1, got ${env.INTAKE_SHADOW_SAMPLE}`,
    );
  }
  return {
    port,
    /** Seconds to keep serving after SIGTERM so load balancers stop routing here first. */
    drainSeconds: Number(env.INTAKE_DRAIN_SECONDS ?? 5),
    live: decider(env.INTAKE_DECIDER ?? 'jev', env.TYPESAFE_API_KEY),
    /** A candidate model that sees a sample of real traffic but never affects a patient. */
    shadow: env.INTAKE_SHADOW_DECIDER
      ? { ...decider(env.INTAKE_SHADOW_DECIDER, env.TYPESAFE_API_KEY), sample: shadowSample }
      : null,
  };
}
