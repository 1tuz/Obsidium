import { appendFileSync } from 'node:fs';

export function route(eventName) {
  if (eventName === 'push') {
    return {
      runChecks: true,
      runAutoMerge: true,
      fullChecks: false,
    };
  }

  return {
    runChecks: true,
    runAutoMerge: false,
    fullChecks: eventName === 'workflow_dispatch',
  };
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const [, , eventName] = process.argv;
  const result = route(eventName);
  const output = Object.entries(result).map(([key, value]) => `${key}=${value}`).join('\n');
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${output}\n`);
  else process.stdout.write(`${output}\n`);
}
