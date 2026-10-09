require 'psych'

paths = ARGV.empty? ? Dir.glob('.github/workflows/*.{yml,yaml}') : ARGV

begin
  paths.each do |path|
    document = Psych.parse_file(path)
    raise "#{path}: empty YAML document" unless document

    visit = lambda do |node|
      return unless node

      if node.is_a?(Psych::Nodes::Mapping)
        keys = {}
        node.children.each_slice(2) do |key_node, value_node|
          if key_node.is_a?(Psych::Nodes::Scalar)
            key = key_node.value
            raise "#{path}:#{key_node.start_line + 1}: duplicate key #{key}" if keys.key?(key)
            keys[key] = true
          end
          visit.call(key_node)
          visit.call(value_node)
        end
      elsif node.respond_to?(:children)
        node.children&.each { |child| visit.call(child) }
      end
    end

    visit.call(document)
    puts "#{path}: valid"
  end
rescue Psych::Exception, RuntimeError => error
  warn error.message
  exit 1
end
