import type { Questions } from '@typesafe-ai/sdk';
import { Ollama } from 'ollama';
import type { Decide } from '../../src/core/run';
import { typedDecide } from '../../src/core/run';
import { fromVerbalized, TYPED_SYSTEM, typedEvaluate, typedPrompt, typedSchema } from './typed';

const ollama = new Ollama();

/** Arm E: the shared typed questions on a model that runs on our own hardware. */
export function localTyped(model: string): Decide {
  return typedDecide(
    typedEvaluate(model, async (state, questions: Questions) => {
      const res = await ollama.chat({
        model,
        think: false,
        format: typedSchema(questions),
        // Prompts are ~2k tokens; the default 262k context reserves a KV cache that crashed the server.
        options: { temperature: 0, num_ctx: 8192 },
        messages: [
          { role: 'system', content: TYPED_SYSTEM },
          { role: 'user', content: typedPrompt(state, questions) },
        ],
      });
      return {
        picked: fromVerbalized(JSON.parse(res.message.content)),
        inputTokens: res.prompt_eval_count,
        outputTokens: res.eval_count,
      };
    }),
  );
}
