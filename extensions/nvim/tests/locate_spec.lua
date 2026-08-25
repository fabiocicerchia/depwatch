-- Where a dependency is written down.
--
-- The CLI reports names; these fixtures are the shapes it reports them from.
-- A wrong answer here underlines the wrong line, which is worse than
-- underlining nothing -- hence the cases for names that must NOT be found.

local core = require('depwatch.core')

local function at(text, filename, name)
  return core.locate(text, filename, { name })[name]
end

describe('shape detection', function()
  it('recognises what it can index, by basename', function()
    assert.equals('json-sections', core.shape_of('/p/package.json'))
    assert.equals('json-sections', core.shape_of('composer.json'))
    assert.equals('cargo-toml', core.shape_of('/p/Cargo.toml'))
    assert.equals('cargo-lock', core.shape_of('/p/Cargo.lock'))
    assert.equals('gemfile-lock', core.shape_of('/p/Gemfile.lock'))
    assert.equals('requirements', core.shape_of('requirements.txt'))
    assert.equals('requirements', core.shape_of('requirements-dev.txt'))
    assert.equals('generic', core.shape_of('/p/bom.json'))
  end)

  it('reads a Windows path as a path, not one long filename', function()
    assert.equals('json-sections', core.shape_of('C:\\repo\\package.json'))
  end)
end)

describe('package.json', function()
  local text = table.concat({
    '{',
    '  "name": "example",',
    '  "scripts": {',
    '    "lodash": "echo not-a-dependency"',
    '  },',
    '  "dependencies": {',
    '    "express": "^4.16.0",',
    '    "lodash": "4.17.4"',
    '  },',
    '  "devDependencies": {',
    '    "vitest": "^4.1.10"',
    '  }',
    '}',
  }, '\n')

  it('finds a dependency, on its own line and column', function()
    local span = at(text, 'package.json', 'express')
    assert.equals(6, span.lnum) -- 0-based
    assert.equals(5, span.col)
    assert.equals(12, span.end_col)
  end)

  it('reads devDependencies too', function()
    assert.equals(10, at(text, 'package.json', 'vitest').lnum)
  end)

  it('is section-aware, so a script named after a package does not win', function()
    -- "lodash" appears in "scripts" first; the dependency is the later one.
    assert.equals(7, at(text, 'package.json', 'lodash').lnum)
  end)

  it('does not find something that is not a dependency', function()
    assert.is_nil(at(text, 'package.json', 'name'))
    assert.is_nil(at(text, 'package.json', 'scripts'))
    assert.is_nil(at(text, 'package.json', 'nonexistent'))
  end)

  it('is not fooled by a brace inside a version string', function()
    local tricky = '{\n  "dependencies": {\n    "weird": "^1.0.0 || {2}",\n    "after": "1.0.0"\n  }\n}'
    assert.equals(3, at(tricky, 'package.json', 'after').lnum)
  end)

  it('handles a scoped name', function()
    local scoped = '{\n  "dependencies": {\n    "@types/node": "^26.0.0"\n  }\n}'
    local span = at(scoped, 'package.json', '@types/node')
    assert.equals(2, span.lnum)
    assert.equals(11, span.end_col - span.col)
  end)
end)

describe('composer.json', function()
  it('reads require and require-dev', function()
    local text = '{\n  "require": {\n    "monolog/monolog": "^2.0"\n  },\n  "require-dev": {\n    "phpunit/phpunit": "^9"\n  }\n}'
    assert.equals(2, at(text, 'composer.json', 'monolog/monolog').lnum)
    assert.equals(5, at(text, 'composer.json', 'phpunit/phpunit').lnum)
  end)
end)

describe('requirements.txt', function()
  local text = table.concat({
    '# comment',
    '-r other.txt',
    'requests==2.28.0',
    'Django>=4.0,<5',
    'pytest [extra] == 7.0',
  }, '\n')

  it('finds a pinned requirement', function()
    local span = at(text, 'requirements.txt', 'requests')
    assert.equals(2, span.lnum)
    assert.equals(0, span.col)
  end)

  it('finds one with a range', function()
    assert.equals(3, at(text, 'requirements.txt', 'Django').lnum)
  end)

  it('matches the way PyPI names packages', function()
    -- The registry answers for "django"; the file says "Django".
    assert.equals(3, at(text, 'requirements.txt', 'django').lnum)
    local under = 'typing_extensions==4.0\n'
    assert.equals(0, at(under, 'requirements.txt', 'typing-extensions').lnum)
  end)

  it('does not treat an option line as a package', function()
    assert.is_nil(at(text, 'requirements.txt', 'r'))
  end)
end)

describe('Cargo.toml', function()
  local text = table.concat({
    '[package]',
    'name = "mycrate"',
    'version = "0.1.0"',
    '',
    '[dependencies]',
    'serde = { version = "1.0", features = ["derive"] }',
    'anyhow = "1.0"',
    '',
    '[dev-dependencies]',
    'criterion = "0.5"',
    '',
    '[dependencies.tokio]',
    'version = "1.0"',
  }, '\n')

  it('finds a plain dependency', function()
    assert.equals(6, at(text, 'Cargo.toml', 'anyhow').lnum)
  end)

  it('finds one written as an inline table', function()
    assert.equals(5, at(text, 'Cargo.toml', 'serde').lnum)
  end)

  it('reads dev-dependencies', function()
    assert.equals(9, at(text, 'Cargo.toml', 'criterion').lnum)
  end)

  it('finds a crate named in the table header itself', function()
    assert.equals(11, at(text, 'Cargo.toml', 'tokio').lnum)
  end)

  it('does not mistake package metadata for a dependency', function()
    -- `name` and `version` sit under [package], not [dependencies].
    assert.is_nil(at(text, 'Cargo.toml', 'name'))
    assert.is_nil(at(text, 'Cargo.toml', 'mycrate'))
  end)
end)

describe('lock files', function()
  it('reads Cargo.lock package names', function()
    local text = '[[package]]\nname = "serde"\nversion = "1.0.0"\n\n[[package]]\nname = "anyhow"\nversion = "1.0.0"\n'
    assert.equals(1, at(text, 'Cargo.lock', 'serde').lnum)
    assert.equals(5, at(text, 'Cargo.lock', 'anyhow').lnum)
  end)

  it('reads Gemfile.lock gem names at their fixed indent', function()
    local text = 'GEM\n  remote: https://rubygems.org/\n  specs:\n    rails (7.0.4)\n    rake (13.0.6)\n'
    assert.equals(3, at(text, 'Gemfile.lock', 'rails').lnum)
    assert.equals(4, at(text, 'Gemfile.lock', 'rake').lnum)
    -- "specs:" is at two spaces, not four, so it is not a gem.
    assert.is_nil(at(text, 'Gemfile.lock', 'specs'))
  end)
end)

describe('an unknown shape', function()
  it('falls back to any JSON key, for an SBOM', function()
    local text = '{\n  "components": [\n    { "name": "left-pad", "version": "1.1.0" }\n  ]\n}'
    -- No structural index to build, so the textual fallback is all there is.
    assert.is_not_nil(at(text, 'bom.json', 'name'))
  end)
end)

describe('locate over a whole report', function()
  it('returns only the names it actually found', function()
    local text = '{\n  "dependencies": {\n    "a": "1",\n    "b": "2"\n  }\n}'
    local spans = core.locate(text, 'package.json', { 'a', 'b', 'transitive-only' })
    assert.is_not_nil(spans.a)
    assert.is_not_nil(spans.b)
    -- A transitive dependency appears in no manifest, so it gets no mark.
    assert.is_nil(spans['transitive-only'])
  end)
end)
