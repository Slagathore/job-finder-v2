// Stamp the built app with its git commit so the update checker can compare
// against origin/main. Runs at the end of `npm run build`.
import { execSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';

let sha = '';
try { sha = execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim(); } catch { /* not a git checkout */ }

mkdirSync('dist-electron', { recursive: true });
writeFileSync('dist-electron/buildinfo.json', JSON.stringify({ sha, builtAt: new Date().toISOString() }) + '\n');
console.log('buildinfo:', sha || '(no git sha)');
