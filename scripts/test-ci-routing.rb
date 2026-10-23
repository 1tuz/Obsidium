require 'psych'

filters = Psych.safe_load(File.read('.github/filters.yml'))
flags = File::FNM_PATHNAME | File::FNM_EXTGLOB | File::FNM_DOTMATCH

raise 'Obsidium application source directory is missing' unless Dir.exist?('obsidium-app')

cases = {
  'documentation' => ['knowledge base/theme-engine.md'],
  'CSS' => ['obsidium-app/src/styles/themes/palettes.css'],
  'TypeScript' => ['obsidium-app/src/modules/theme/index.ts'],
  'frontend configuration' => ['obsidium-app/vite.config.ts'],
  'shared frontend module' => ['obsidium-app/src/modules/documents/fileGateway.ts'],
  'Rust core' => ['obsidium-app/core/src/search/service.rs'],
  'frontend dependency' => ['obsidium-app/package-lock.json'],
  'Rust dependency' => ['obsidium-app/src-tauri/Cargo.lock'],
  'multiple areas' => ['obsidium-app/src/App.tsx', 'obsidium-app/core/src/lib.rs'],
  'workflow only' => ['.github/workflows/ci.yml'],
  'installer scripts' => ['scripts/install.ps1', 'scripts/uninstall.sh'],
}

matches = lambda do |filter, path|
  filters.fetch(filter, []).any? { |pattern| File.fnmatch?(pattern, path, flags) }
end

raise 'agent_surface filter is missing' unless filters['agent_surface'].is_a?(Array)

agent_surface = filters.fetch('agent_surface')
required_agent_patterns = [
  'obsidium-app/cli/**',
  'obsidium-app/core/src/mcp/**',
  'obsidium-app/core/src/links/**',
  'obsidium-app/core/src/wiki/**',
  'obsidium-app/core/src/search/tasks/**',
  'scripts/agent-smoke.mjs',
]
required_agent_patterns.each do |pattern|
  raise "agent_surface must include #{pattern}" unless agent_surface.include?(pattern)
end

{
  'CLI source' => 'obsidium-app/cli/src/main.rs',
  'MCP source' => 'obsidium-app/core/src/mcp/tools/mod.rs',
  'links source' => 'obsidium-app/core/src/links/mod.rs',
  'wiki source' => 'obsidium-app/core/src/wiki/mod.rs',
  'tasks source' => 'obsidium-app/core/src/search/tasks/repository.rs',
  'agent smoke script' => 'scripts/agent-smoke.mjs',
}.each do |name, path|
  matched = agent_surface.any? do |pattern|
    File.fnmatch?(pattern, path, flags) || File.fnmatch?("#{pattern}/*", path, flags)
  end
  raise "agent_surface must match the #{name}" unless matched
end

expected = {
  'documentation' => { 'docs' => true },
  'CSS' => { 'frontend_full' => true },
  'TypeScript' => { 'frontend_types' => true, 'frontend_related' => true },
  'frontend configuration' => { 'frontend_types' => true, 'frontend_full' => true },
  'shared frontend module' => { 'frontend_types' => true, 'frontend_related' => true },
  'Rust core' => { 'rust_core' => true },
  'frontend dependency' => { 'frontend_types' => true, 'frontend_full' => true },
  'Rust dependency' => { 'rust_lock' => true },
  'multiple areas' => { 'frontend_types' => true, 'frontend_related' => true, 'rust_core' => true },
  'workflow only' => { 'workflow' => true },
  'installer scripts' => { 'installer_scripts' => true },
}

cases.each do |name, paths|
  actual = filters.keys.to_h { |filter| [filter, paths.any? { |path| matches.call(filter, path) } ] }
  expected.fetch(name).each do |filter, value|
    raise "#{name}: expected #{filter}=#{value}, got #{actual[filter]}" unless actual[filter] == value
  end
  if name == 'documentation'
    raise 'documentation must not trigger application tests' if actual.values_at('frontend_types', 'frontend_related', 'frontend_full', 'rust_core', 'rust_app', 'rust_cli', 'rust_workspace').include?(true)
  end
  if name == 'Rust dependency'
    raise 'a lockfile change must not rebuild the workspace' if actual['rust_workspace']
  end
  puts "#{name}: #{actual.select { |_, value| value }.keys.join(', ')}"
end
