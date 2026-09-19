import { readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {createDefaultTransport,endpoint} from './transport.mjs';

export const configPath = join(homedir(), '.config', 'codex-jev-desktop', 'config.json');
export {endpoint};

export async function loadConfig(path = configPath) {
  try {
    const info = await stat(path);
    if ((info.mode & 0o077) !== 0) throw new Error('CONFIG_PERMISSIONS: config.json must be 0600');
    const config = JSON.parse(await readFile(path, 'utf8'));
    if (config.provider !== 'typesafe' || typeof config.apiKey !== 'string' || config.apiKey.length < 12) {
      throw new Error('CONFIG_INVALID');
    }
    return config;
  } catch (e) {
    if (e.code === 'ENOENT') throw new Error('KEY_MISSING: run scripts/setup.py and enter the TypeSafe key locally');
    throw e;
  }
}

export function validateChoice(answer, criteria) {
  const ids = Object.keys(criteria);
  const validNumber = n => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1;
  if (!answer || !ids.includes(answer.choice) || !validNumber(answer.confidence) || !answer.probabilities) {
    throw new Error('INVALID_MODEL_CHOICE');
  }
  const probabilities = answer.probabilities;
  const values = Object.values(probabilities);
  if (Object.keys(probabilities).length !== ids.length || !ids.every(id => Object.hasOwn(probabilities, id))
      || !values.every(validNumber) || Math.abs(values.reduce((a,b) => a+b, 0) - 1) > .025
      || probabilities[answer.choice] + 1e-6 < Math.max(...values)) {
    throw new Error('INVALID_MODEL_PROBABILITIES');
  }
  return answer;
}

export function createClient(config, fetchImpl) {
  if (!config.apiKey) throw new Error('KEY_MISSING');
  fetchImpl ??= createDefaultTransport();
  return async (state, questions, {signal, timeoutMs = 7000} = {}) => {
    const started = performance.now();
    const timeout = AbortSignal.timeout(Math.max(1, Math.round(timeoutMs)));
    const requestSignal=signal ? AbortSignal.any([signal, timeout]) : timeout;
    let response;
    try {
      response = await fetchImpl(endpoint, {
        method: 'POST', redirect: 'error',
        headers: {'Authorization': `Bearer ${config.apiKey}`, 'Content-Type': 'application/json'},
        body: JSON.stringify({model: config.model || 'jev-latest', state, questions}),
        signal: requestSignal,
      });
    } catch {
      throw new Error(signal?.aborted ? 'CANCELLED' : 'MODEL_NETWORK_OR_TIMEOUT');
    }
    if (!response.ok) {
      const retry = Number(response.headers.get('retry-after'));
      throw new Error(`TYPESAFE_HTTP_${response.status}${retry > 0 ? `: retry after ${retry}s` : ''}`);
    }
    // Never include provider body, API key or prompt in thrown errors.
    let data;
    try { data = await response.json(); requestSignal.throwIfAborted(); }
    catch { throw new Error(signal?.aborted?'CANCELLED':requestSignal.aborted?'MODEL_NETWORK_OR_TIMEOUT':'INVALID_MODEL_JSON'); }
    if (!data?.answers) throw new Error('INVALID_MODEL_RESPONSE');
    return {answers: data.answers, model: data.model, usage: data.usage || {}, latencyMs: Math.round(performance.now() - started)};
  };
}

export async function probe() {
  const config = await loadConfig();
  const result = await createClient(config)('A local test screen contains a button labelled Preview.', {
    action: {type: 'choice', criteria: {preview: 'Click Preview', stop: 'Nothing to preview'}, instructions: 'Select the Preview button.'},
  }, {timeoutMs: 12000});
  const action = validateChoice(result.answers.action, {preview: '', stop: ''});
  return {configured: true, provider: 'typesafe', model: result.model, latencyMs: result.latencyMs, choice: action.choice, confidence: action.confidence, usage: result.usage};
}
