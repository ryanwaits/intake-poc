import Anthropic from '@anthropic-ai/sdk';
import type { Questions } from '@typesafe-ai/sdk';
import type { Decide } from '../../src/core/run';
import { typedDecide } from '../../src/core/run';
import { E2E_SYSTEM, e2ePrompt, e2eSchema, fromE2E } from './e2e';
import { fromVerbalized, TYPED_SYSTEM, typedEvaluate, typedPrompt, typedSchema } from './typed';

const client = new Anthropic();

function jsonText(res: Anthropic.Message): unknown {
  if (res.stop_reason === 'refusal') throw new Error('Refusal');
  if (res.stop_reason === 'max_tokens') throw new Error('Hit max_tokens');
  const text = res.content.find((b): b is Anthropic.TextBlock => b.type === 'text')?.text;
  if (!text) throw new Error('No text block');
  return JSON.parse(text);
}

/** Arm C: the shared typed questions, thinking off, verbalized confidence. */
export function claudeTyped(model: string): Decide {
  return typedDecide(
    typedEvaluate(model, async (state, questions: Questions) => {
      const res = await client.messages.create({
        model,
        max_tokens: 4000,
        system: TYPED_SYSTEM,
        thinking: { type: 'disabled' },
        output_config: { format: { type: 'json_schema', schema: typedSchema(questions) } },
        messages: [{ role: 'user', content: typedPrompt(state, questions) }],
      });
      return {
        picked: fromVerbalized(jsonText(res)),
        inputTokens: res.usage.input_tokens,
        outputTokens: res.usage.output_tokens,
      };
    }),
  );
}

/** Arms F and G: one holistic prompt, adaptive thinking at low effort. */
export function claudeE2E(model: string): Decide {
  return async (intake) => {
    const started = performance.now();
    const res = await client.messages.create({
      model,
      max_tokens: 8000,
      system: E2E_SYSTEM,
      output_config: { effort: 'low', format: { type: 'json_schema', schema: e2eSchema(intake) } },
      messages: [{ role: 'user', content: e2ePrompt(intake) }],
    });
    return fromE2E(intake, jsonText(res) as Parameters<typeof fromE2E>[1], model, {
      inputTokens: res.usage.input_tokens,
      outputTokens: res.usage.output_tokens,
      latencyMs: Math.round(performance.now() - started),
    });
  };
}
