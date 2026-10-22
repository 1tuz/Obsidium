import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const executable = process.platform === 'win32' ? 'obsidium.exe' : 'obsidium';
const bin = process.env.OBSIDIUM_BIN
  ? path.resolve(process.env.OBSIDIUM_BIN)
  : path.join(repoRoot, 'obsidium-app/src-tauri/target/debug', executable);
const full = process.argv.includes('--full');
const root = mkdtempSync(path.join(tmpdir(), 'obsidium-agent-smoke-'));
const dataDir = path.join(root, 'data');
const vault = path.join(root, 'vault');
const secondVault = path.join(root, 'second-vault');
const planFile = path.join(root, 'plan.json');
const bigNote = path.join(vault, 'Большая.md');

let checks = 0;

function sleep(milliseconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

function environment() {
  const value = { ...process.env, OBSIDIUM_DATA_DIR: dataDir };
  delete value.OBSIDIUM_WORKSPACE;
  return value;
}

function cli(args, options = {}) {
  return spawnSync(bin, ['--workspace', options.workspace ?? vault, '--json', ...args], {
    cwd: repoRoot,
    env: environment(),
    encoding: 'utf8',
    input: options.input,
    timeout: 120_000,
    maxBuffer: 64 * 1024 * 1024,
  });
}

function ok(result, label) {
  assert.equal(
    result.status,
    0,
    `${label}: exited with ${result.status}\n${result.stdout}\n${result.stderr}`,
  );
  return result;
}

function json(result, label) {
  ok(result, label);
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    throw new Error(`${label}: stdout is not JSON: ${result.stdout.slice(0, 300)}`);
  }
}

function eventually(label, body, timeout = 30_000) {
  const deadline = Date.now() + timeout;
  let last;
  for (;;) {
    try {
      const value = body();
      if (value !== undefined && value !== false) {
        return value;
      }
    } catch (error) {
      last = error;
    }
    if (Date.now() > deadline) {
      throw new Error(`${label} timed out${last ? `: ${last.message}` : ''}`);
    }
    sleep(250);
  }
}

async function check(name, body) {
  try {
    await body();
  } catch (error) {
    console.error(`not ok ${checks + 1} - ${name}`);
    console.error(error?.stack ?? String(error));
    console.error(`fixture kept at ${root}`);
    process.exit(1);
  }
  checks += 1;
  console.log(`ok ${checks} - ${name}`);
}

function search(term, extra = [], workspace = vault) {
  return json(cli(['search', term, ...extra], { workspace }), `search ${term}`);
}

function waitForSearch(term, predicate, workspace = vault) {
  return eventually(`search ${term}`, () => {
    const payload = search(term, ['--limit', '50'], workspace);
    return payload.indexing ? undefined : predicate(payload) ? payload : undefined;
  });
}

function seed() {
  mkdirSync(dataDir, { recursive: true });
  mkdirSync(vault, { recursive: true });
  mkdirSync(secondVault, { recursive: true });
  writeFileSync(
    path.join(vault, 'Kubernetes.md'),
    '---\ntags: [kubernetes]\n---\n# Kubernetes\n\npaginate cluster operations.\n\n- [ ] Deploy the cluster\n',
  );
  writeFileSync(path.join(vault, 'Linked.md'), '# Linked\n\npaginate links to [[Kubernetes]]\n');
  writeFileSync(path.join(vault, 'Заметки.md'), '# Заметки\n\npaginate кириллица\n');
  const filler = Array.from(
    { length: 450 },
    (_, index) => `строка ${String(index).padStart(3, '0')} ${'данные '.repeat(8)}`,
  ).join('\n');
  writeFileSync(bigNote, `# Большая заметка\n\npaginate\n\n${filler}\n`);
  writeFileSync(path.join(secondVault, 'Other.md'), '# Other\n\nsecondmarker only here\n');
}

async function quickChecks() {
  await check('search --json finds the seeded notes', () => {
    const payload = waitForSearch('paginate', (value) => value.results.length === 4);
    const paths = payload.results.map((item) => item.path);
    for (const expected of ['Kubernetes.md', 'Linked.md', 'Заметки.md', 'Большая.md']) {
      assert.ok(paths.includes(expected), `missing ${expected} in ${paths.join(', ')}`);
    }
  });

  await check('search pages through results without duplicates', () => {
    waitForSearch('paginate', (value) => value.results.length === 4);
    const first = search('paginate', ['--limit', '2', '--offset', '0']);
    const second = search('paginate', ['--limit', '2', '--offset', '2']);
    assert.equal(first.results.length, 2);
    assert.equal(second.results.length, 2);
    const paths = [...first.results, ...second.results].map((item) => item.path);
    assert.equal(new Set(paths).size, 4, paths.join(', '));
    assert.equal(first.hasMore, true);
    assert.equal(second.hasMore, false);
  });

  await check('note read --json returns the note contract', () => {
    const note = json(cli(['note', 'read', 'Kubernetes.md']), 'note read');
    assert.equal(note.path, 'Kubernetes.md');
    assert.match(note.hash, /^[0-9a-f]{64}$/u);
    assert.ok(note.frontmatter.tags.includes('kubernetes'));
    assert.match(note.content, /# Kubernetes/u);
  });

  await check('note update with a stale hash exits 3', () => {
    const before = readFileSync(path.join(vault, 'Kubernetes.md'), 'utf8');
    const result = cli([
      'note',
      'update',
      'Kubernetes.md',
      '--content',
      '# overwritten',
      '--expected-hash',
      '0'.repeat(64),
    ]);
    assert.equal(result.status, 3, `${result.stdout}\n${result.stderr}`);
    assert.equal(readFileSync(path.join(vault, 'Kubernetes.md'), 'utf8'), before);
  });

  await check('links add is idempotent and remove drops the edge', () => {
    const notePath = path.join(vault, 'Заметки.md');
    const before = readFileSync(notePath, 'utf8');
    const added = json(cli(['links', 'add', 'Заметки.md', 'Kubernetes']), 'links add');
    assert.equal(added.changed, true);
    const linked = readFileSync(notePath, 'utf8');
    assert.ok(linked.includes('[[Kubernetes]]'), linked);
    const again = json(cli(['links', 'add', 'Заметки.md', 'Kubernetes']), 'links add twice');
    assert.equal(again.changed, false);
    assert.equal(readFileSync(notePath, 'utf8'), linked);
    eventually('backlinks Kubernetes', () => {
      const payload = json(cli(['backlinks', 'Kubernetes']), 'backlinks');
      return payload.backlinks.some((item) => item.path === 'Заметки.md') ? payload : undefined;
    });
    const removed = json(cli(['links', 'remove', 'Заметки.md', 'Kubernetes']), 'links remove');
    assert.equal(removed.changed, true);
    assert.ok(!readFileSync(notePath, 'utf8').includes('[[Kubernetes]]'));
    assert.ok(before.includes('paginate'));
  });

  await check('task add and toggle update the note text', () => {
    const added = json(
      cli(['task', 'add', 'Kubernetes.md', 'Rotate the certificate']),
      'task add',
    );
    const created = added.tasks.find((task) => task.text === 'Rotate the certificate');
    assert.ok(created, JSON.stringify(added.tasks));
    const toggled = json(
      cli(['task', 'toggle', 'Kubernetes.md', '--line', String(created.line), '--done']),
      'task toggle',
    );
    const closed = toggled.tasks.find((task) => task.text === 'Rotate the certificate');
    assert.equal(closed.done, true);
    const listed = json(
      cli(['task', 'list', '--note', 'Kubernetes.md']),
      'task list',
    );
    const found = listed.tasks.find((task) => task.text === 'Rotate the certificate');
    assert.equal(found.done, true);
    assert.match(
      readFileSync(path.join(vault, 'Kubernetes.md'), 'utf8'),
      /- \[x\] Rotate the certificate/u,
    );
  });

  await check('note context --json exposes outline, tasks, and backlinks', () => {
    const context = json(
      cli(['note', 'context', 'Kubernetes.md', '--sections', 'outline,tasks,backlinks']),
      'note context',
    );
    assert.ok(Array.isArray(context.outline), JSON.stringify(context));
    assert.ok(Array.isArray(context.tasks), JSON.stringify(context));
    assert.ok(Array.isArray(context.backlinks), JSON.stringify(context));
  });

  await check('query --json LIST returns rows', () => {
    const payload = eventually('query LIST', () => {
      const value = json(cli(['query', 'LIST']), 'query');
      return Array.isArray(value.rows) && value.rows.length > 0 ? value : undefined;
    });
    assert.ok(payload.rows.length > 0);
  });

  await check('transaction preview, apply, and rollback cover two notes', () => {
    const linkedPath = path.join(vault, 'Linked.md');
    const notesPath = path.join(vault, 'Заметки.md');
    const linkedBefore = readFileSync(linkedPath, 'utf8');
    const notesBefore = readFileSync(notesPath, 'utf8');
    writeFileSync(
      planFile,
      JSON.stringify({
        edits: [
          { note: 'Linked.md', content: '# Linked\n\ntransaction applied\n' },
          { note: 'Заметки.md', content: '# Заметки\n\ntransaction applied\n' },
        ],
      }),
    );
    const preview = json(cli(['transaction', 'preview', '--file', planFile]), 'preview');
    assert.equal(preview.changes.length, 2);
    assert.ok(preview.changes.every((change) => change.changed));
    const applied = json(cli(['transaction', 'apply', '--file', planFile]), 'apply');
    assert.equal(applied.changed, 2);
    assert.match(readFileSync(linkedPath, 'utf8'), /transaction applied/u);
    const rolled = json(
      cli(['transaction', 'rollback', '--transaction-id', applied.transactionId]),
      'rollback',
    );
    assert.equal(rolled.rolledBack, 2);
    assert.equal(readFileSync(linkedPath, 'utf8'), linkedBefore);
    assert.equal(readFileSync(notesPath, 'utf8'), notesBefore);
  });

  await check('mcp stdio answers initialize, tools/list, and read_note', () => {
    const messages = [
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } },
      { jsonrpc: '2.0', id: 2, method: 'tools/list' },
      {
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: { name: 'read_note', arguments: { note: 'Kubernetes.md' } },
      },
    ];
    const result = spawnSync(bin, ['--workspace', vault, 'mcp', 'stdio'], {
      cwd: repoRoot,
      env: environment(),
      input: `${messages.map((message) => JSON.stringify(message)).join('\n')}\n`,
      encoding: 'utf8',
      timeout: 120_000,
      maxBuffer: 64 * 1024 * 1024,
    });
    ok(result, 'mcp stdio');
    const lines = result.stdout.split('\n').filter((line) => line.trim() !== '');
    assert.equal(lines.length, 3, result.stdout);
    const responses = lines.map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        throw new Error(`stdout line ${index + 1} is not JSON: ${line}`);
      }
    });
    assert.deepEqual(responses.map((response) => response.id), [1, 2, 3]);
    assert.equal(responses[0].result.serverInfo.name, 'obsidium');
    assert.ok(Array.isArray(responses[1].result.tools));
    assert.ok(responses[1].result.tools.length > 10);
    assert.equal(responses[2].result.isError, false);
    assert.equal(responses[2].result.structuredContent.path, 'Kubernetes.md');
  });
}

async function fullChecks() {
  await check('cyrillic note paths round-trip through create, read, and update', () => {
    const created = json(
      cli(['note', 'create', 'Кириллица/Заметка.md', '--content', '# Заметка\n\nкириллица\n']),
      'create cyrillic',
    );
    assert.equal(created.path, 'Кириллица/Заметка.md');
    const read = json(cli(['note', 'read', 'Кириллица/Заметка.md']), 'read cyrillic');
    assert.equal(read.path, 'Кириллица/Заметка.md');
    assert.match(read.content, /кириллица/u);
    const updated = json(
      cli(['note', 'update', 'Кириллица/Заметка.md', '--mode', 'append', '--content', 'обновлено']),
      'update cyrillic',
    );
    assert.equal(updated.changed, true);
    const again = json(cli(['note', 'read', 'Кириллица/Заметка.md']), 'reread cyrillic');
    assert.equal(again.path, 'Кириллица/Заметка.md');
    assert.match(again.content, /обновлено/u);
  });

  await check('the large note supports offset and limit windows', () => {
    const head = json(cli(['note', 'read', 'Большая.md', '--limit', '100']), 'read big head');
    assert.ok(head.totalChars >= 30_000, String(head.totalChars));
    assert.equal([...head.content].length, 100);
    assert.equal(head.truncated, true);
    assert.equal(head.nextOffset, 100);
    const window = json(
      cli(['note', 'read', 'Большая.md', '--offset', '100', '--limit', '100']),
      'read big window',
    );
    assert.equal([...window.content].length, 100);
    assert.notEqual(window.content, head.content);
    const tail = json(
      cli(['note', 'read', 'Большая.md', '--offset', String(head.totalChars - 50), '--limit', '100']),
      'read big tail',
    );
    assert.equal([...tail.content].length, 50);
    assert.equal(tail.truncated, false);
  });

  await check('the second workspace stays isolated from the first', () => {
    waitForSearch(
      'secondmarker',
      (value) => value.results.some((item) => item.path === 'Other.md'),
      secondVault,
    );
    const foreign = search('paginate', [], secondVault);
    assert.equal(foreign.results.length, 0, JSON.stringify(foreign.results));
    const created = json(
      cli(['note', 'create', 'Second.md', '--content', '# Second\n\nleak-marker\n'], {
        workspace: secondVault,
      }),
      'create second vault note',
    );
    assert.equal(created.path, 'Second.md');
    waitForSearch(
      'leak-marker',
      (value) => value.results.some((item) => item.path === 'Second.md'),
      secondVault,
    );
    waitForSearch('paginate', (value) => value.results.length === 4);
    const leaked = search('leak-marker');
    assert.equal(leaked.results.length, 0, JSON.stringify(leaked.results));
  });

  await check('search finds text written a moment earlier', () => {
    writeFileSync(path.join(vault, 'Indexed.md'), '# Indexed\n\nfreshneedle token\n');
    waitForSearch('freshneedle', (value) =>
      value.results.some((item) => item.path === 'Indexed.md'),
    );
  });

  await check('concurrent updates let exactly one writer win with exit 3', async () => {
    const notePath = path.join(vault, 'Concurrent.md');
    writeFileSync(notePath, '# Concurrent\n\nbase\n');
    const read = json(cli(['note', 'read', 'Concurrent.md']), 'read concurrent');
    const winner = '# Concurrent\n\nwinner-a\n';
    const loser = `# Concurrent\n\nwinner-b\n${'x'.repeat(1024 * 1024)}`;
    const update = (content, dataDirectory) =>
      new Promise((resolve) => {
        const child = spawn(
          bin,
          [
            '--workspace',
            vault,
            '--json',
            'note',
            'update',
            'Concurrent.md',
            '--stdin',
            '--expected-hash',
            read.hash,
          ],
          {
            cwd: repoRoot,
            env: { ...environment(), OBSIDIUM_DATA_DIR: dataDirectory },
          },
        );
        let stdout = '';
        let stderr = '';
        child.stdout.setEncoding('utf8');
        child.stderr.setEncoding('utf8');
        child.stdout.on('data', (chunk) => {
          stdout += chunk;
        });
        child.stderr.on('data', (chunk) => {
          stderr += chunk;
        });
        child.stdin.on('error', () => {});
        child.on('close', (code) => resolve({ code, stdout, stderr }));
        child.stdin.end(content);
      });
    const [first, second] = await Promise.all([
      update(winner, path.join(root, 'concurrent-a')),
      update(loser, path.join(root, 'concurrent-b')),
    ]);
    const codes = [first.code, second.code].sort();
    assert.deepEqual(
      codes,
      [0, 3],
      `expected one winner\n${first.code}: ${first.stdout}${first.stderr}\n${second.code}: ${second.stdout}${second.stderr}`,
    );
    assert.match(read.hash, /^[0-9a-f]{64}$/u);
    const final = readFileSync(notePath, 'utf8');
    assert.equal(final, first.code === 0 ? winner : loser);
  });
}

seed();
await check('the obsidium binary is available', () => {
  assert.ok(
    existsSync(bin),
    `${bin} is missing; run cargo build --locked --manifest-path obsidium-app/src-tauri/Cargo.toml -p obsidium-cli`,
  );
});
await quickChecks();
if (full) {
  await fullChecks();
}
rmSync(root, { recursive: true, force: true });
console.log(`agent smoke: ${checks} checks passed${full ? ' (full)' : ''}`);
