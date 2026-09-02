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

local lens = require('depwatch.lens')

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

-- The vocabulary, from lens.lua, re-exported: core is what the rest of the
-- plugin requires, and moving a name out of it would be an API change for the
-- sake of a file boundary.
M.QUADRANTS = lens.QUADRANTS
M.LENSES = lens.LENSES
M.LABEL = lens.LABEL
M.BLURB = lens.BLURB
M.lens_of = lens.lens_of

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

-- --- grouping the report -----------------------------------------------------
--
-- Three axes, because the report answers three different questions: "what is
-- wrong in this file", "what is worst everywhere", and "which registry is the
-- problem". depwatch has no rules to group by -- there is no rule engine, the
-- two axes are measured -- so `severity` is the quadrant, which is what
-- severity means here, and `ecosystem` is the third real axis.

M.GROUP_BY = { 'file', 'severity', 'ecosystem' }

--- Worst first, and unknown last: a dep the registry would not answer for is
--- not a to-do, so it does not belong above one.
local LENS_RANK = { replace = 0, upgrade = 1, watch = 2, healthy = 3, degraded = 4 }

local GROUP = {
  file = {
    key = function(scan)
      return scan.label
    end,
    title = function(scan)
      return string.format('%s  (%s)', scan.label, scan.report.ecosystem or '?')
    end,
  },
  severity = {
    key = function(_, dep)
      return lens.lens_of(dep)
    end,
    title = function(_, dep)
      local at = lens.lens_of(dep)
      return string.format('%s — %s', lens.LABEL[at], lens.BLURB[at])
    end,
    rank = function(key)
      return LENS_RANK[key] or 9
    end,
  },
  ecosystem = {
    key = function(scan, dep)
      return dep.ecosystem or scan.report.ecosystem or 'unknown'
    end,
    title = function(scan, dep)
      return dep.ecosystem or scan.report.ecosystem or 'unknown'
    end,
    -- Alphabetical; keys are unique, so this is a total order and Lua's
    -- unstable sort cannot shuffle equal elements.
    rank = function()
      return 0
    end,
  },
}

--- The report's rows, bucketed.
---
--- Returns a list of `{ key, title, rows }`, each row `{ scan, dep }`, worst
--- first within a group. `file` keeps a manifest with nothing to say, because
--- "this one is clean" is an answer; the other axes have no bucket for it.
---@param scans table[] list of { path, label, report }
---@param mode string|nil one of M.GROUP_BY; anything else falls back to 'file'
function M.group_report(scans, mode)
  local spec = GROUP[mode] or GROUP.file
  local groups, order = {}, {}

  local function bucket(key, title)
    local group = groups[key]
    if not group then
      group = { key = key, title = title, rows = {} }
      groups[key] = group
      order[#order + 1] = group
    end
    return group
  end

  for _, scan in ipairs(scans) do
    -- Only `file` can name an empty bucket: there is no dependency to ask which
    -- severity or ecosystem an empty manifest would sit under.
    if spec == GROUP.file then
      bucket(spec.key(scan), spec.title(scan))
    end
    for _, dep in ipairs(M.sorted_deps(scan.report)) do
      local group = bucket(spec.key(scan, dep), spec.title(scan, dep))
      group.rows[#group.rows + 1] = { scan = scan, dep = dep }
    end
  end

  -- `file` is left in insertion order: the scans arrive sorted by label, and
  -- table.sort is not stable, so sorting again could only make it worse.
  if spec.rank then
    table.sort(order, function(a, b)
      local ra, rb = spec.rank(a.key), spec.rank(b.key)
      if ra ~= rb then
        return ra < rb
      end
      return a.key < b.key
    end)
    for _, group in ipairs(order) do
      table.sort(group.rows, function(a, b)
        return M.compare_deps(a.dep, b.dep)
      end)
    end
  end
  return order
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

-- --- the facade --------------------------------------------------------------
--
-- Explaining a finding and finding where it is written are two jobs of their
-- own, and they live in their own files. They are re-exported here because
-- `core` is the name the rest of the plugin -- and its specs -- already ask
-- for, and a file boundary is not a reason to move a public name.

local explain = require('depwatch.explain')
local locate = require('depwatch.locate')

M.years = explain.years
M.summarise = explain.summarise
M.reasons = explain.reasons
M.registry_url = explain.registry_url
M.hover_lines = explain.hover_lines

M.basename = locate.basename
M.shape_of = locate.shape_of
M.locate = locate.locate

return M
