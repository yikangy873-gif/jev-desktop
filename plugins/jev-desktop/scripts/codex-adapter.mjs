/** A local run/state/stop facade for use inside the documented CUA REPL.
 * The caller owns the approved target; this module never creates or closes it.
 * AX decisions and prepared text remain governed by createSession's allowlists.
 */
import {createSession} from './runner.mjs';

function compact(result,includeTrace=false) {
  const {trace,...rest}=result;
  return includeTrace?{...rest,trace}:rest;
}

export function createCodexJev(options) {
  // Every CUA entry point requires an injected client. Callers normally supply
  // createLocalBridgeClient(); neither this facade nor runner.mjs loads the key.
  if(typeof options?.client!=='function') throw new Error('CODEX_ADAPTER_REQUIRES_BRIDGE_CLIENT');
  // Fix target and goal at construction; run options only control the chunk.
  const session=createSession({...options});
  const target=options.target;
  let running=false,stopped=false,lastExecution=null;

  function state() {
    const current=compact(session.status());
    if(current.status===lastExecution?.status && lastExecution.verified!==undefined) current.verified=lastExecution.verified;
    return {...current,running,stopped};
  }

  async function run({maxMs,maxActions,captureFinalScreenshot=false,includeTrace=false}={}) {
    if(running) throw new Error('ADAPTER_ALREADY_RUNNING');
    running=true;
    try {
      const before=performance.now();
      const result=await session.run({maxMs,maxActions});
      // Measures this adapter's execution phase only, not full user-turn latency.
      const adapterElapsedMs=performance.now()-before;
      if(result.status==='done' && lastExecution?.verified===true) result.verified=true;
      lastExecution={status:result.status,verified:result.verified};
      const output={...compact(result,includeTrace),adapterElapsedMs,screenshotMs:0,screenshotStatus:'not_requested'};
      if(captureFinalScreenshot) {
        output.screenshotStatus='unavailable';
        if(stopped) output.screenshotReason='SCREENSHOT_SKIPPED_CANCELLED';
        else {
          const screenshotStart=performance.now();
          try {
            // One optional final capture, never included in the Jev request.
            const screenshot=await target.getScreenshot({emit:false});
            if(screenshot==null) throw new Error('EMPTY_SCREENSHOT');
            output.finalScreenshot=screenshot;
            output.screenshotStatus='captured';
          } catch {
            output.screenshotReason='SCREENSHOT_UNAVAILABLE';
          } finally {output.screenshotMs=performance.now()-screenshotStart;}
        }
      }
      return output;
    } finally {running=false;}
  }

  return {
    run,state,
    stop(){stopped=true;session.cancel();return state();},
    latestState(){return session.latestState();},
  };
}
