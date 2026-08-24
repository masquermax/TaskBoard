import { closeSync, mkdirSync, openSync, writeSync } from 'node:fs';
import { dirname } from 'node:path';

export function installRuntimeLogMirror({
  logFile,
  redirected = process.env.TASKBOARD_STDIO_REDIRECTED === '1',
  stdout = process.stdout,
  stderr = process.stderr,
} = {}) {
  if (!logFile || redirected) return { enabled:false, close(){} };

  mkdirSync(dirname(logFile), { recursive:true });
  const fd=openSync(logFile,'a');
  const originalStdout=stdout.write.bind(stdout);
  const originalStderr=stderr.write.bind(stderr);
  let closed=false;

  const mirroredWrite=original=>function write(chunk, encoding, callback) {
    const result=original(chunk, encoding, callback);
    if (!closed) {
      try {
        const data=Buffer.isBuffer(chunk)
          ? chunk
          : Buffer.from(String(chunk),typeof encoding==='string'?encoding:undefined);
        writeSync(fd,data);
      } catch { /* logging must never break Runtime */ }
    }
    return result;
  };

  stdout.write=mirroredWrite(originalStdout);
  stderr.write=mirroredWrite(originalStderr);

  const close=()=>{
    if (closed) return;
    closed=true;
    stdout.write=originalStdout;
    stderr.write=originalStderr;
    try { closeSync(fd); } catch { /* ignore shutdown logging failure */ }
  };
  process.once('exit',close);
  return { enabled:true, close };
}
