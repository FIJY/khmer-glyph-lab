import { spawn } from 'node:child_process';

const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const children = [];
let shuttingDown = false;

function run(scriptName) {
  const child = spawn(npmCmd, ['run', scriptName], {
    stdio: 'inherit',
    env: process.env,
    shell: false
  });

  child.on('exit', (code, signal) => {
    if (shuttingDown) return;

    if (code !== 0) {
      console.error(`[dev-runner] ${scriptName} exited with code ${code}${signal ? ` (signal: ${signal})` : ''}`);
      shutdown(code ?? 1);
    }
  });

  children.push(child);
}

function shutdown(exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;

  for (const child of children) {
    if (!child.killed) {
      child.kill('SIGTERM');
    }
  }

  setTimeout(() => process.exit(exitCode), 150);
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

run('dev:server');
run('dev:client');
