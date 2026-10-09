import { appendFileSync } from 'node:fs';

export function route(eventName, hasOpenPullRequest = false) {
  if (eventName === 'push') {
    return {
      runChecks: !hasOpenPullRequest,
      runAutoMerge: !hasOpenPullRequest,
      fullChecks: false,
    };
  }

  return {
    runChecks: true,
    runAutoMerge: eventName === 'pull_request',
    fullChecks: eventName === 'workflow_dispatch',
  };
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const [, , eventName, openPullRequest = 'false'] = process.argv;
  const result = route(eventName, openPullRequest === 'true');
  const output = Object.entries(result).map(([key, value]) => `${key}=${value}`).join('\n');
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${output}\n`);
  else process.stdout.write(`${output}\n`);
}
