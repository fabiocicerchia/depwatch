-- The ported logic: everything that decides what a finding says and where it
-- goes, with no reference to the editor.
--
-- depwatch itself is not reimplemented here. The CLI already measures drift and
-- viability, and reimplementing sixteen ecosystem parsers and their registry
-- clients in Lua would produce a second answer to a question that has one --
-- so this builds the command line, reads the JSON it prints, and works out
-- where in the manifest each dependency is written.
--
-- No `vim.` calls: the whole module is testable under plain Lua.

local M = {}

local function append(list, ...)
  for _, value in ipairs({ ... }) do
    list[#list + 1] = value
  end
  return list
end

-- --- the command line --------------------------------------------------------

--- Argv for `depwatch check`, as a list.
---@param cfg table resolved configuration
---@param manifest string path to the manifest
---@param opts table|nil { deep = bool, baseline = string|nil }
---
--- `opts.baseline` is a path to pass as `--accepted`, or nil for none. The
--- caller decides: an explicit `--accepted` that is not there is an error to
--- the CLI (deliberately -- a typo in a flag should not be a silent no-op), so
--- whether the file exists is a question only something that can stat it may
--- answer.
function M.check_argv(cfg, manifest, opts)
  opts = opts or {}
  local argv = { 'check', manifest, '--json' }
  if opts.deep or cfg.deep then
    table.insert(argv, '--deep')
  end
  if cfg.transitive then
    table.insert(argv, '--transitive')
  end
  if not cfg.use_lock_file then
    table.insert(argv, '--no-lock')
  end
  -- Sent even at their defaults: the plugin's defaults and the CLI's are
  -- allowed to drift apart, and the number on screen has to be the one the
  -- configuration asked for.
  append(argv, '--stale', tostring(cfg.thresholds.stale_libyears))
  append(argv, '--risky', tostring(cfg.thresholds.risky_viability))
  if opts.baseline then
    append(argv, '--accepted', opts.baseline)
  end
  return argv
end

function M.write_baseline_argv(cfg, manifest)
  return { 'check', manifest, '--write-accepted', cfg.baseline.path }
end

function M.trend_argv(cfg, manifest)
  return { 'trend', manifest, '--json', '--max-points', tostring(cfg.trend.max_points) }
end

-- --- reading the report ------------------------------------------------------

local QUADRANTS = { 'replace', 'upgrade', 'watch', 'healthy' }
M.QUADRANTS = QUADRANTS

--- Every quadrant, plus the pseudo-quadrant for deps the registry would not
--- answer for. A dep we could not reach is unknown, not unhealthy.
M.LENSES = { 'replace', 'upgrade', 'watch', 'healthy', 'degraded' }

M.LABEL = {
  replace = 'Replace',
  upgrade = 'Upgrade',
  watch = 'Watch',
  healthy = 'Healthy',
  degraded = 'no data',
}

M.BLURB = {
  replace = 'behind and unmaintained — the upgrade you need may never be written',
  upgrade = 'behind but alive — the newer version exists, it is just work',
  watch = 'current but fading — nothing to upgrade to yet, and nobody obviously shipping one',
  healthy = 'current, and maintained',
  degraded = 'the registry did not answer for these packages',
}

--- Which lens a dependency belongs under.
function M.lens_of(dep)
  if dep.degraded then
    return 'degraded'
  end
  return dep.quadrant
end

--- Worst first. Every surface orders this way, so it lives here rather than
--- being spelled out again in each of them.
local RANK = { replace = 0, upgrade = 1, watch = 2, healthy = 3 }

function M.compare_deps(a, b)
  local ra, rb = RANK[a.quadrant] or 9, RANK[b.quadrant] or 9
  if ra ~= rb then
    return ra < rb
  end
  if a.libyearsBehind ~= b.libyearsBehind then
    return a.libyearsBehind > b.libyearsBehind
  end
  return a.name < b.name
end

function M.sorted_deps(report)
  local deps = {}
  for i, dep in ipairs(report.deps or {}) do
    deps[i] = dep
  end
  table.sort(deps, M.compare_deps)
  return deps
end

--- Whether a decoded value actually looks like a depwatch report. A CLI that
--- printed a warning before its JSON, or an older one with a different shape,
--- should be an error the user can read rather than a nil index later on.
function M.is_report(value)
  return type(value) == 'table'
    and type(value.deps) == 'table'
    and type(value.totalLibyears) == 'number'
    and type(value.file) == 'string'
end

-- --- totals ------------------------------------------------------------------

local function round2(n)
  return math.floor(n * 100 + 0.5) / 100
end

M.round2 = round2

--- The bottom line across a set of reports.
function M.totals(reports)
  local counts = { replace = 0, upgrade = 0, watch = 0, healthy = 0 }
  local libyears, deps, degraded = 0, 0, 0
  for _, report in ipairs(reports) do
    libyears = libyears + (report.totalLibyears or 0)
    for _, dep in ipairs(report.deps or {}) do
      deps = deps + 1
      if dep.degraded then
        degraded = degraded + 1
      else
        counts[dep.quadrant] = (counts[dep.quadrant] or 0) + 1
      end
    end
  end
  return {
    libyears = round2(libyears),
    deps = deps,
    counts = counts,
    degraded = degraded,
    -- Everything off the healthy quadrant. Deps with no registry data are not
    -- in here: unknown is not a to-do, and counting it would make a flaky
    -- registry look like work.
    to_address = counts.replace + counts.upgrade + counts.watch,
  }
end

function M.summary_label(totals)
  local drift = string.format('%.2f libyears', totals.libyears)
  if totals.deps == 0 then
    return drift
  end
  if totals.to_address == 0 then
    return drift .. ' · nothing to address'
  end
  return string.format(
    '%s · %d of %d %s to address',
    drift,
    totals.to_address,
    totals.deps,
    totals.deps == 1 and 'dep' or 'deps'
  )
end

-- --- the gates ---------------------------------------------------------------

--- The editor's copy of `depwatch check --ci`. A gate that says "fail" in CI
--- and "fine" in the editor is worse than no gate at all, so the arithmetic
--- matches src/gates.ts exactly.
function M.gate_failures(report, gates)
  local fails = {}
  if gates.max_libyears ~= nil and report.totalLibyears > gates.max_libyears then
    table.insert(fails, {
      gate = 'max-libyears',
      message = string.format(
        'total drift %.2f libyears exceeds max_libyears %s',
        report.totalLibyears,
        tostring(gates.max_libyears)
      ),
    })
  end
  if gates.max_replace ~= nil then
    local replace = 0
    for _, dep in ipairs(report.deps or {}) do
      if not dep.degraded and dep.quadrant == 'replace' then
        replace = replace + 1
      end
    end
    if replace > gates.max_replace then
      table.insert(fails, {
        gate = 'max-replace',
        message = string.format(
          '%d deps in the replace quadrant exceeds max_replace %s',
          replace,
          tostring(gates.max_replace)
        ),
      })
    end
  end
  return fails
end

-- --- saying why --------------------------------------------------------------

local function years(n)
  if n < 1 / 12 then
    return 'less than a month'
  end
  if n < 1 then
    return string.format('%d months', math.max(1, math.floor(n * 12 + 0.5)))
  end
  return string.format('%.1f years', n)
end

M.years = years

local function days(n)
  local whole = math.floor(n + 0.5)
  if whole < 45 then
    return string.format('%d days', whole)
  end
  if whole < 365 then
    return string.format('%d months', math.floor(whole / 30 + 0.5))
  end
  return string.format('%.1f years', whole / 365.25)
end

local function threshold_note(t)
  return string.format(
    'Behind means over %s libyears; fading means viability under %s.',
    tostring(t.stale_libyears),
    tostring(t.risky_viability)
  )
end

--- The one-line message that goes on the diagnostic.
function M.summarise(dep, thresholds)
  if dep.degraded then
    return string.format('%s: no registry data (%s) — not scored', dep.name, dep.degraded)
  end
  local bits = {
    string.format('%.2f libyears behind', dep.libyearsBehind),
    string.format('viability %.2f', dep.viability),
  }
  if dep.latest and dep.latest ~= dep.current then
    table.insert(bits, string.format('%s → %s', dep.current, dep.latest))
  end
  return string.format(
    '%s: %s — %s. %s. %s',
    dep.name,
    M.LABEL[dep.quadrant],
    table.concat(bits, ', '),
    M.BLURB[dep.quadrant],
    threshold_note(thresholds)
  )
end

--- Everything the report knows about one dependency, worst first: the reason
--- someone should care goes at the top of the hover, not the bottom.
function M.reasons(dep)
  if dep.degraded then
    return { string.format('the registry did not answer for this package (%s)', dep.degraded) }
  end
  local out = {}
  local s = dep.signals or {}
  local function add(line)
    table.insert(out, line)
  end

  if s.archived then
    add('the repository is **archived** — the maintainer has said the project is over')
  end
  if dep.libyearsBehind > 0 and dep.currentReleased and dep.latestReleased then
    add(string.format(
      '**%.2f libyears behind**: %s shipped %s, %s shipped %s',
      dep.libyearsBehind,
      dep.current,
      dep.currentReleased:sub(1, 10),
      tostring(dep.latest),
      dep.latestReleased:sub(1, 10)
    ))
  elseif dep.latest == dep.current then
    add(string.format('on the latest release (%s)', tostring(dep.latest)))
  end
  if dep.pulseYears ~= nil then
    add(string.format('last release %s ago', years(dep.pulseYears)))
  end
  if s.lastCommitAgeDays ~= nil then
    add(string.format('last commit %s ago', days(s.lastCommitAgeDays)))
  end
  if s.releaseCadenceDays ~= nil then
    add(string.format('ships about every %s', days(s.releaseCadenceDays)))
  end
  if s.maintainerCount ~= nil then
    if s.maintainerCount <= 0 then
      add('no maintainers listed')
    elseif s.maintainerCount == 1 then
      add('**one maintainer** — one person is one bus')
    else
      add(string.format('%d maintainers', s.maintainerCount))
    end
  end
  if s.hasFunding then
    add('has a funding channel')
  end
  if dep.resolved == false then
    add('version read from a range, not a lock file — the real drift is this or lower')
  end
  if s.maintainerCount == nil and s.lastCommitAgeDays == nil and not s.archived then
    add('scored from the release timeline only — run a deep scan for maintainers, archived status and last commit')
  end
  return out
end

local REGISTRY_URL = {
  npm = 'https://www.npmjs.com/package/%s',
  pep440 = 'https://pypi.org/project/%s/',
  cargo = 'https://crates.io/crates/%s',
  composer = 'https://packagist.org/packages/%s',
  rubygems = 'https://rubygems.org/gems/%s',
}

function M.registry_url(ecosystem, name)
  local pattern = REGISTRY_URL[ecosystem]
  return pattern and pattern:format(name) or nil
end

--- The hover, as markdown lines.
function M.hover_lines(dep, thresholds, ecosystem)
  local head
  if dep.degraded then
    head = string.format('**%s** — not scored', dep.name)
  else
    local arrow = ''
    if dep.latest and dep.latest ~= dep.current then
      arrow = string.format(' → **%s**', dep.latest)
    end
    head = string.format('**%s** %s%s', dep.name, dep.current, arrow)
  end

  local badge
  if dep.degraded then
    badge = '`no data`'
  else
    badge = string.format(
      '`%s` drift **%.2f** ly · viability **%.2f**',
      M.LABEL[dep.quadrant],
      dep.libyearsBehind,
      dep.viability
    )
  end

  local lines = { head, '', badge .. ' · ' .. M.BLURB[M.lens_of(dep)], '' }
  for _, reason in ipairs(M.reasons(dep)) do
    table.insert(lines, '- ' .. reason)
  end
  table.insert(lines, '')
  table.insert(lines, '_' .. threshold_note(thresholds) .. '_')

  local url = M.registry_url(dep.ecosystem or ecosystem, dep.name)
  if url then
    table.insert(lines, '')
    table.insert(lines, string.format('[%s on the registry](%s)', dep.name, url))
  end
  return lines
end

-- --- where a dependency is written -------------------------------------------
--
-- The CLI reports names, not positions: it reads lock files and SBOMs, where a
-- position would be meaningless. So the manifest is indexed once per scan and
-- the names are looked up in it -- one pass, whatever the file, because a
-- package-lock.json is measured in megabytes and a pattern search per
-- dependency over one of those is something the editor would feel.

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

--- [dependencies] tables, plus the [dependencies.foo] form that names the
--- crate in the header itself.
local function index_cargo_toml(text)
  local out, in_deps = {}, false
  each_line(text, function(line, lnum)
    local trimmed = line:gsub('#.*$', ''):match('^%s*(.-)%s*$')
    if trimmed:sub(1, 1) == '[' then
      local body = trimmed:gsub('^%[+', ''):gsub('%]+$', '')
      local segments = {}
      for segment in body:gmatch('[^.]+') do
        segments[#segments + 1] = segment
      end
      local last = segments[#segments]
      local prev = segments[#segments - 1]
      in_deps = DEP_TABLES[last] == true
      if not in_deps and last and DEP_TABLES[prev] and not out[last] then
        local col = line:find(last, 1, true)
        if col then
          out[last] = span(last, lnum, col - 1)
        end
      end
      return
    end
    if not in_deps then
      return
    end
    local name = trimmed:match('^([A-Za-z0-9._-]+)%s*=')
    if name and not out[name] then
      local col = line:find(name, 1, true)
      if col then
        out[name] = span(name, lnum, col - 1)
      end
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
