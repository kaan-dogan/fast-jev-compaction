import type { JevAnswer, JevQuestions, JevResponse, JevState } from './types.js';

export const SYSTEM_ONE_URL = 'https://api.typesafe.ai/v1/systemone';
export const DEFAULT_MODEL = 'jev-latest';
/** Jev's model id on the Vercel AI Gateway. */
export const GATEWAY_MODEL = 'typesafe-ai/jev';

/**
 * Whether `url` is the Vercel AI Gateway's Jev endpoint, which speaks a
 * different dialect: `boolean` questions answered with `probability`, and
 * provider-prefixed model ids.
 */
export function isGatewayUrl(url: string | undefined): boolean {
  if (!url) return false;
  try {
    return new URL(url).hostname === 'ai-gateway.vercel.sh';
  } catch {
    return false;
  }
}

export interface JevRequest {
  url: string;
  method: 'POST';
  headers: Record<string, string>;
  body: string;
}

/** The HTTP request for one Jev call, for any fetch-like transport. */
export function buildJevRequest(
  params: {
    apiKey: string;
    model?: string;
    baseUrl?: string;
  },
  state: JevState,
  questions: JevQuestions,
): JevRequest {
  const gateway = isGatewayUrl(params.baseUrl);
  let model = params.model ?? DEFAULT_MODEL;
  if (gateway && !model.includes('/')) model = GATEWAY_MODEL;
  const sent = gateway ? toGatewayQuestions(questions) : questions;
  return {
    url: params.baseUrl ?? SYSTEM_ONE_URL,
    method: 'POST',
    headers: {
      authorization: `Bearer ${params.apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model,
      state,
      questions: sent,
    }),
  };
}

/** The gateway has no `noul` type; its `boolean` question is the same probability. */
function toGatewayQuestions(questions: JevQuestions): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [name, question] of Object.entries(questions)) {
    out[name] = question.type === 'noul' ? { ...question, type: 'boolean' } : question;
  }
  return out;
}

/** Validates a Jev response body; throws on anything but an `answers` object. */
export function parseJevResponse(
  status: number,
  ok: boolean,
  text: string,
): JevResponse {
  if (!ok) {
    throw new Error(`Jev request failed (${status}): ${text.slice(0, 200)}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('Jev returned malformed JSON');
  }
  if (
    parsed === null ||
    typeof parsed !== 'object' ||
    !('answers' in parsed) ||
    parsed.answers === null ||
    typeof parsed.answers !== 'object'
  ) {
    throw new Error('Jev response is missing answers');
  }
  return parsed as JevResponse;
}

/**
 * The `noul` probability of one answer (or the gateway's `boolean`
 * `probability`); throws when it is not there.
 */
export function noulAnswer(
  answers: Record<string, JevAnswer>,
  name: string,
): number {
  const answer = answers[name];
  if (
    answer &&
    'probability' in answer &&
    typeof answer.probability === 'number' &&
    Number.isFinite(answer.probability)
  ) {
    return answer.probability;
  }
  if (
    !answer ||
    !('noul' in answer) ||
    typeof answer.noul !== 'number' ||
    !Number.isFinite(answer.noul)
  ) {
    throw new Error(`Invalid Jev answer for ${name}`);
  }
  return answer.noul;
}
