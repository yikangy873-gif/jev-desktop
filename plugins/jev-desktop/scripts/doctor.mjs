import { loadConfig, probe } from './client.mjs';
try {
  if (process.argv.includes('--live')) console.log(JSON.stringify(await probe(), null, 2));
  else { const c = await loadConfig(); console.log(JSON.stringify({configured: true, provider:c.provider, model:c.model, credential:'present, not displayed'})); }
} catch (e) { console.log(JSON.stringify({configured:false,error:e.message})); process.exitCode=1; }
