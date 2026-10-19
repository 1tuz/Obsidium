import { describe, expect, it } from 'vitest';
import { languageForPath } from './codeViewer';

describe('languageForPath', () => {
  it.each([
    ['script.py', 'Python'],
    ['config.yaml', 'YAML'],
    ['config.yml', 'YAML'],
    ['package.json', 'JSON'],
    ['run.sh', 'Shell'],
    ['main.rs', 'Rust'],
    ['App.swift', 'Swift'],
    ['Main.kt', 'Kotlin'],
    ['index.ts', 'TypeScript'],
    ['view.tsx', 'TSX'],
    ['index.js', 'JavaScript'],
    ['page.html', 'HTML'],
    ['styles.css', 'CSS'],
    ['query.sql', 'SQL'],
    ['Cargo.toml', 'TOML'],
  ])('maps %s to %s', (path, name) => {
    expect(languageForPath(path)?.name).toBe(name);
  });

  it('matches a language by file name when there is no extension', () => {
    expect(languageForPath('Dockerfile')?.name).toBe('Dockerfile');
  });

  it('returns null for unknown extensions instead of guessing', () => {
    expect(languageForPath('notes.unknownext')).toBeNull();
  });
});
