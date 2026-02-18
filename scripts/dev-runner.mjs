import { spawn } from 'node:child_process';

const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const npmExecPath = process.env.npm_execpath;
const children = [];
let shuttingDown = false;

function run(scriptName) {
  const child = spawnNpmRun(scriptName);

  child.on('exit', (code, signal) => {
    if (shuttingDown) return;

    if (code !== 0) {
      console.error(`[dev-runner] ${scriptName} exited with code ${code}${signal ? ` (signal: ${signal})` : ''}`);
      shutdown(code ?? 1);
    }
  });

  children.push(child);
}

function spawnNpmRun(scriptName) {
  // Windows PowerShell/Node 22 can throw spawn EINVAL for npm.cmd.
  // When invoked via npm, npm_execpath points to npm-cli.js;
  // spawning node + npm-cli.js is the most portable path.
  if (npmExecPath) {
    return spawn(process.execPath, [npmExecPath, 'run', scriptName], {
      stdio: 'inherit',
      env: process.env,
      shell: false
    });
  }

  return spawn(npmCmd, ['run', scriptName], {
    stdio: 'inherit',
    env: process.env,
    shell: process.platform === 'win32'
  });
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
