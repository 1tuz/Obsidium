require 'psych'

filters = Psych.safe_load(File.read('.github/filters.yml'))
flags = File::FNM_PATHNAME | File::FNM_EXTGLOB | File::FNM_DOTMATCH

cases = {
  'documentation' => ['knowledge base/theme-engine.md'],
  'CSS' => ['aquilum-app/src/styles/themes/palettes.css'],
  'TypeScript' => ['aquilum-app/src/modules/theme/index.ts'],
  'frontend configuration' => ['aquilum-app/vite.config.ts'],
  'shared frontend module' => ['aquilum-app/src/modules/documents/fileGateway.ts'],
  'Rust core' => ['aquilum-app/core/src/search/service.rs'],
  'frontend dependency' => ['aquilum-app/package-lock.json'],
  'Rust dependency' => ['aquilum-app/src-tauri/Cargo.lock'],
  'multiple areas' => ['aquilum-app/src/App.tsx', 'aquilum-app/core/src/lib.rs'],
  'workflow only' => ['.github/workflows/ci.yml'],
}

matches = lambda do |filter, path|
  filters.fetch(filter, []).any? { |pattern| File.fnmatch?(pattern, path, flags) }
end

expected = {
  'documentation' => { 'docs' => true },
  'CSS' => { 'frontend_full' => true },
  'TypeScript' => { 'frontend_types' => true, 'frontend_related' => true },
  'frontend configuration' => { 'frontend_types' => true, 'frontend_full' => true },
  'shared frontend module' => { 'frontend_types' => true, 'frontend_related' => true },
  'Rust core' => { 'rust_core' => true },
  'frontend dependency' => { 'frontend_types' => true, 'frontend_full' => true },
  'Rust dependency' => { 'rust_workspace' => true },
  'multiple areas' => { 'frontend_types' => true, 'frontend_related' => true, 'rust_core' => true },
  'workflow only' => { 'workflow' => true },
}

cases.each do |name, paths|
  actual = filters.keys.to_h { |filter| [filter, paths.any? { |path| matches.call(filter, path) } ] }
  expected.fetch(name).each do |filter, value|
    raise "#{name}: expected #{filter}=#{value}, got #{actual[filter]}" unless actual[filter] == value
  end
  if name == 'documentation'
    raise 'documentation must not trigger application tests' if actual.values_at('frontend_types', 'frontend_related', 'frontend_full', 'rust_core', 'rust_app', 'rust_cli', 'rust_workspace').include?(true)
  end
  puts "#{name}: #{actual.select { |_, value| value }.keys.join(', ')}"
end
