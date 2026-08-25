-- Defaults, and the validation that keeps a typo from becoming a runtime error
-- three seconds later inside a callback.

-- core has no `vim.` calls and requires nothing, so this cannot loop: it is
-- here only so the list of grouping axes has one home.
local core = require('depwatch.core')

local M = {}

---@class DepwatchConfig
M.defaults = {
  --- Scan dependency manifests in this project.
  enabled = true,

  --- How to run depwatch. A list, so an interpreter can be put in front of it:
  --- `{ 'node', '/path/to/dist/cli.js' }` for a checkout, `{ 'depwatch' }` for
  --- an installed wrapper.
  cmd = { 'depwatch' },

  --- Filenames to look for. Matched against the basename; a lock file sitting
  --- beside a manifest is picked up by depwatch itself, so list the manifests.
  manifests = {
    'package.json',
    'requirements.txt',
    'Cargo.toml',
    'composer.json',
    'Gemfile.lock',
    'go.mod',
    'pyproject.toml',
    'pom.xml',
    'bom.json',
  },

  --- Directory names never descended into while looking for manifests.
  exclude = {
    'node_modules',
    'bower_components',
    'vendor',
    'dist',
    'out',
    'build',
    'target',
    '.venv',
    'venv',
    '__pycache__',
    '.git',
  },

  --- Stop after this many manifests. A monorepo with 300 package.json files is
  --- a scan nobody asked for.
  max_manifests = 25,

  --- Fetch maintainer count, funding, archived status and last commit. Two
  --- extra requests per package and GitHub rate-limits hard without a token, so
  --- this is off for scans on save; :DepwatchDeepScan turns it on for one run.
  deep = false,

  --- Score the whole dependency tree from the lock file, not just the
  --- dependencies you chose.
  transitive = false,

  --- Read the lock file beside a manifest when there is one. Off, drift is
  --- measured from version ranges and becomes an upper bound rather than a
  --- measurement.
  use_lock_file = true,

  thresholds = {
    --- Libyears above which a dependency counts as behind.
    stale_libyears = 1,
    --- Viability below which a dependency counts as fading.
    risky_viability = 0.5,
  },

  --- The editor's copy of `depwatch check --ci`. nil disables a gate.
  gates = {
    max_libyears = nil,
    max_replace = nil,
  },

  scan = {
    --- Scan when the plugin first loads.
    on_startup = true,
    --- Rescan a manifest when it is written. Nothing is scanned while you type.
    on_save = true,
    --- Wait this long after a write before scanning, so a burst costs one scan.
    debounce_ms = 1500,
    --- Re-check unchanged manifests this often, to catch releases published
    --- elsewhere. 0 turns the timer off.
    refresh_minutes = 360,
    --- Give up on a scan that takes longer than this.
    timeout_ms = 120000,
  },

  diagnostics = {
    enabled = true,
    --- Severity per quadrant. `false` publishes nothing for that quadrant.
    severity = {
      replace = vim.diagnostic.severity.WARN,
      upgrade = vim.diagnostic.severity.INFO,
      watch = vim.diagnostic.severity.INFO,
      healthy = false,
      degraded = false,
    },
  },

  --- Drift shown at the end of the line the dependency is written on.
  virtual_text = {
    enabled = true,
    --- Quadrants worth annotating inline. Healthy dependencies are the majority
    --- of a manifest and annotating them is noise.
    lenses = { 'replace', 'upgrade', 'watch' },
    prefix = '  ',
  },

  baseline = {
    --- Where the baseline lives, relative to the project root. The same file
    --- `depwatch check --accepted` reads, so committing it gives CI and the
    --- editor one answer to "how much drift do we already live with".
    path = '.depwatch-baseline.json',
  },

  report = {
    --- How |:DepwatchReport| buckets its rows: 'file', 'severity' (the
    --- quadrant) or 'ecosystem'. |:DepwatchGroupBy| changes it for the session.
    group_by = 'file',
  },

  trend = {
    --- How many commits :DepwatchTrend samples.
    max_points = 12,
  },
}

--- Deep-merged over the defaults, so a user setting one threshold does not lose
--- the other.
local function merge(defaults, opts)
  local out = {}
  for key, value in pairs(defaults) do
    if type(value) == 'table' and not vim.islist(value) then
      out[key] = merge(value, (opts or {})[key] or {})
    elseif opts and opts[key] ~= nil then
      out[key] = opts[key]
    else
      out[key] = value
    end
  end
  -- Keys the defaults do not mention (gates.max_libyears is nil by default, so
  -- it would otherwise be dropped by the loop above).
  for key, value in pairs(opts or {}) do
    if out[key] == nil then
      out[key] = value
    end
  end
  return out
end

local SEVERITIES = {
  [vim.diagnostic.severity.ERROR] = true,
  [vim.diagnostic.severity.WARN] = true,
  [vim.diagnostic.severity.INFO] = true,
  [vim.diagnostic.severity.HINT] = true,
}

--- Validated eagerly and loudly. A bad value that only shows up when the first
--- scan finishes is a bug report about the wrong thing.
function M.validate(cfg)
  vim.validate('enabled', cfg.enabled, 'boolean')
  vim.validate('cmd', cfg.cmd, function(v)
    return vim.islist(v) and #v > 0 and type(v[1]) == 'string'
  end, 'a non-empty list of strings')
  vim.validate('manifests', cfg.manifests, vim.islist, 'a list of filenames')
  vim.validate('exclude', cfg.exclude, vim.islist, 'a list of directory names')
  vim.validate('max_manifests', cfg.max_manifests, function(v)
    return type(v) == 'number' and v >= 1
  end, 'a number >= 1')
  vim.validate('deep', cfg.deep, 'boolean')
  vim.validate('transitive', cfg.transitive, 'boolean')
  vim.validate('use_lock_file', cfg.use_lock_file, 'boolean')
  vim.validate('thresholds.stale_libyears', cfg.thresholds.stale_libyears, 'number')
  vim.validate('thresholds.risky_viability', cfg.thresholds.risky_viability, function(v)
    return type(v) == 'number' and v >= 0 and v <= 1
  end, 'a number between 0 and 1')
  vim.validate('gates.max_libyears', cfg.gates.max_libyears, 'number', true)
  vim.validate('gates.max_replace', cfg.gates.max_replace, 'number', true)
  vim.validate('scan.on_startup', cfg.scan.on_startup, 'boolean')
  vim.validate('scan.on_save', cfg.scan.on_save, 'boolean')
  vim.validate('scan.debounce_ms', cfg.scan.debounce_ms, 'number')
  vim.validate('scan.refresh_minutes', cfg.scan.refresh_minutes, 'number')
  vim.validate('scan.timeout_ms', cfg.scan.timeout_ms, 'number')
  vim.validate('diagnostics.enabled', cfg.diagnostics.enabled, 'boolean')
  for lens, severity in pairs(cfg.diagnostics.severity) do
    vim.validate('diagnostics.severity.' .. lens, severity, function(v)
      return v == false or SEVERITIES[v] == true
    end, 'false, or a vim.diagnostic.severity value')
  end
  vim.validate('virtual_text.enabled', cfg.virtual_text.enabled, 'boolean')
  vim.validate('virtual_text.lenses', cfg.virtual_text.lenses, vim.islist, 'a list of quadrants')
  vim.validate('baseline.path', cfg.baseline.path, 'string')
  vim.validate('report.group_by', cfg.report.group_by, function(v)
    return vim.tbl_contains(core.GROUP_BY, v)
  end, "one of '" .. table.concat(core.GROUP_BY, "', '") .. "'")
  vim.validate('trend.max_points', cfg.trend.max_points, function(v)
    return type(v) == 'number' and v >= 2
  end, 'a number >= 2')
  return cfg
end

function M.resolve(opts)
  return M.validate(merge(M.defaults, opts or {}))
end

return M
