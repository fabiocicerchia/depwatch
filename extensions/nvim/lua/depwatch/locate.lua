-- Where a dependency is written down.
--
-- The CLI reports names, not positions: it reads lock files and SBOMs, where a
-- position would be meaningless. So the manifest is indexed once per scan and
-- the names are looked up in it -- one pass, whatever the file, because a
-- package-lock.json is measured in megabytes and a pattern search per
-- dependency over one of those is something the editor would feel.
--
-- No `vim.` calls: the whole module is testable under plain Lua.

local M = {}

local SECTIONS = {
  ['package.json'] = { 'dependencies', 'devDependencies', 'optionalDependencies' },
  ['composer.json'] = { 'require', 'require-dev' },
}

function M.basename(path)
  return path:match('[^/\\]+$') or path
end

--- Which indexing strategy a filename calls for.
function M.shape_of(filename)
  local base = M.basename(filename)
  if SECTIONS[base] then
    return 'json-sections'
  elseif base == 'Cargo.toml' then
    return 'cargo-toml'
  elseif base == 'Cargo.lock' then
    return 'cargo-lock'
  elseif base == 'Gemfile.lock' then
    return 'gemfile-lock'
  elseif base:match('^requirements.*%.txt$') then
    return 'requirements'
  end
  return 'generic'
end

--- Every JSON key in the text, with its nesting depth and position.
---
--- A character walk rather than a pattern per line: a brace inside a version
--- string must not end an object early, and `"name"` as a *value* is not a key.
local function json_keys(text)
  local keys, depth, i, lnum, line_start = {}, 0, 1, 1, 1
  local n = #text
  while i <= n do
    local c = text:sub(i, i)
    if c == '\n' then
      lnum, line_start, i = lnum + 1, i + 1, i + 1
    elseif c == '"' then
      local start = i + 1
      local j = start
      while j <= n do
        local ch = text:sub(j, j)
        if ch == '\\' then
          j = j + 2
        elseif ch == '"' then
          break
        else
          j = j + 1
        end
      end
      local name = text:sub(start, j - 1)
      local k = j + 1
      while k <= n and text:sub(k, k):match('%s') do
        k = k + 1
      end
      if text:sub(k, k) == ':' then
        keys[#keys + 1] = { name = name, depth = depth, lnum = lnum - 1, col = start - line_start }
      end
      i = j + 1
    elseif c == '{' or c == '[' then
      depth, i = depth + 1, i + 1
    elseif c == '}' or c == ']' then
      depth, i = depth - 1, i + 1
    else
      i = i + 1
    end
  end
  return keys
end

local function span(name, lnum, col)
  return { lnum = lnum, col = col, end_col = col + #name }
end

--- Keys of the dependency objects. Section-aware, so a package called
--- "scripts" lands on the right line.
local function index_json_sections(text, sections)
  local want = {}
  for _, section in ipairs(sections) do
    want[section] = true
  end
  local out, inside = {}, false
  for _, key in ipairs(json_keys(text)) do
    if key.depth == 1 then
      inside = want[key.name] == true
    elseif key.depth == 2 and inside and not out[key.name] then
      out[key.name] = span(key.name, key.lnum, key.col)
    end
  end
  return out
end

--- Nothing structural to parse (an SBOM): every JSON key, first one wins.
local function index_json_any(text)
  local out = {}
  for _, key in ipairs(json_keys(text)) do
    if not out[key.name] then
      out[key.name] = span(key.name, key.lnum, key.col)
    end
  end
  return out
end

local function each_line(text, visit)
  local lnum = 0
  for line in (text .. '\n'):gmatch('([^\n]*)\n') do
    visit(line, lnum)
    lnum = lnum + 1
  end
end

local function index_by_line(text, pattern)
  local out = {}
  each_line(text, function(line, lnum)
    local name = line:match(pattern)
    if name and not out[name] then
      local col = line:find(name, 1, true)
      if col then
        out[name] = span(name, lnum, col - 1)
      end
    end
  end)
  return out
end

local DEP_TABLES = {
  dependencies = true,
  ['dev-dependencies'] = true,
  ['build-dependencies'] = true,
}

--- Remember `name` at its position on this line, first mention winning.
local function remember(out, name, line, lnum)
  if out[name] then
    return
  end
  local col = line:find(name, 1, true)
  if col then
    out[name] = span(name, lnum, col - 1)
  end
end

--- A `[table.header]` line: says whether what follows is a dependency table,
--- and files the crate named by the `[dependencies.foo]` form as it goes.
local function cargo_header(out, trimmed, line, lnum)
  local segments = {}
  for segment in trimmed:gsub('^%[+', ''):gsub('%]+$', ''):gmatch('[^.]+') do
    segments[#segments + 1] = segment
  end
  local last, prev = segments[#segments], segments[#segments - 1]
  if DEP_TABLES[last] then
    return true
  end
  if last and DEP_TABLES[prev] then
    remember(out, last, line, lnum)
  end
  return false
end

--- [dependencies] tables, plus the [dependencies.foo] form that names the
--- crate in the header itself.
local function index_cargo_toml(text)
  local out, in_deps = {}, false
  each_line(text, function(line, lnum)
    local trimmed = line:gsub('#.*$', ''):match('^%s*(.-)%s*$')
    if trimmed:sub(1, 1) == '[' then
      in_deps = cargo_header(out, trimmed, line, lnum)
      return
    end
    local name = in_deps and trimmed:match('^([A-Za-z0-9._-]+)%s*=')
    if name then
      remember(out, name, line, lnum)
    end
  end)
  return out
end

local function build_index(text, filename, shape)
  if shape == 'json-sections' then
    return index_json_sections(text, SECTIONS[M.basename(filename)] or {})
  elseif shape == 'requirements' then
    return index_by_line(text, '^%s*([A-Za-z0-9._-]+)')
  elseif shape == 'cargo-toml' then
    return index_cargo_toml(text)
  elseif shape == 'cargo-lock' then
    return index_by_line(text, '^%s*name%s*=%s*"([^"]+)"')
  elseif shape == 'gemfile-lock' then
    return index_by_line(text, '^    ([A-Za-z0-9._-]+) %(')
  end
  return index_json_any(text)
end

-- PyPI treats "-", "_" and case as the same character; nothing else here does,
-- so this is only ever a last resort.
local function normalise(name)
  return name:lower():gsub('_', '-')
end

--- Where each of `names` is written in `text`.
---
--- A name the index did not find is simply absent from the result rather than
--- guessed at: underlining some other line that happens to contain the string
--- is worse than underlining nothing.
---@return table<string, {lnum:integer, col:integer, end_col:integer}>
function M.locate(text, filename, names)
  local index = build_index(text, filename, M.shape_of(filename))
  local out = {}
  for _, name in ipairs(names) do
    local hit = index[name] or index[name:lower()] or index[normalise(name)]
    if not hit then
      -- Only where there is no shape worth parsing: for a known shape, a name
      -- the index missed is a name that is not in the file.
      for key, value in pairs(index) do
        if normalise(key) == normalise(name) then
          hit = value
          break
        end
      end
    end
    if hit then
      out[name] = hit
    end
  end
  return out
end

return M
