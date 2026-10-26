// Runs the game server (tsx watch) and the Vite client together.
import { spawn } from 'node:child_process';
const run = (cmd, args) => spawn(cmd, args, { stdio: 'inherit', shell: process.platform === 'win32' });
const procs = [run('npx', ['tsx', 'watch', 'src/server/index.ts']), run('npx', ['vite'])];
const stop = () => { for (const p of procs) p.kill(); process.exit(); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
