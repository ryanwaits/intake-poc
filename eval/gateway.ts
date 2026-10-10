/**
 * Minimal client for Vercel AI Gateway's OpenAI-compatible API.
 * Used by eval tooling (case writer, checker), never by the product.
 */
const URL = 'https://ai-gateway.vercel.sh/v1/chat/completions';

/** Running spend for this process, from the gateway's own per-call `usage.cost`. */
export const spend = { usd: 0, calls: 0 };

export type ChatRequest = {
  model: string;
  system?: string;
  user: string;
  temperature?: number;
  /** Strict JSON schema for structured output. */
  schema?: { name: string; schema: Record<string, unknown> };
  reasoningEffort?: 'minimal' | 'low' | 'medium' | 'high';
};

export async function chat(req: ChatRequest, budgetUsd: number): Promise<string> {
  if (spend.usd >= budgetUsd) throw new Error(`Budget of $${budgetUsd} reached`);
  const apiKey = process.env.AI_GATEWAY_API_KEY;
  if (!apiKey) throw new Error('AI_GATEWAY_API_KEY is not set');

  const res = await fetch(URL, {
    method: 'POST',
    headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model: req.model,
      temperature: req.temperature,
      reasoning_effort: req.reasoningEffort,
      messages: [
        ...(req.system ? [{ role: 'system', content: req.system }] : []),
        { role: 'user', content: req.user },
      ],
      response_format: req.schema
        ? { type: 'json_schema', json_schema: { ...req.schema, strict: true } }
        : undefined,
    }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`Gateway ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const body = (await res.json()) as {
    choices: { message: { content: string } }[];
    usage?: { cost?: number };
  };
  spend.usd += body.usage?.cost ?? 0;
  spend.calls += 1;
  const content = body.choices[0]?.message.content;
  if (!content) throw new Error('Gateway returned no content');
  return content.trim();
}
