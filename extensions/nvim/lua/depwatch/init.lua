-- setup(), the public API, and the scan policy.
--
-- The policy is deliberately dull: on startup, when a manifest is written, on a
-- slow timer, or when asked. Never while you type. Every scan is a subprocess
-- run through vim.system with a callback, so nothing here blocks the UI.

local cli = require('depwatch.cli')
local commands = require('depwatch.commands')
local config = require('depwatch.config')
local core = require('depwatch.core')
local discover = require('depwatch.discover')
local notify = require('depwatch.notify')
local triggers = require('depwatch.triggers')
local ui = require('depwatch.ui')

local M = {}

---@type table|nil
local cfg = nil

--- path -> { label, report, scanned_at, deep }
local results = {}
--- Scans in flight, so they can be cancelled and so a second save does not
--- start a duplicate.
local running = {}
local log_lines = {}
--- The report's grouping for this session. Set from config at setup.
local grouping = 'file'

local function log(fmt, ...)
  local line = string.format('[%s] ' .. fmt, os.date('%H:%M:%S'), ...)
  log_lines[#log_lines + 1] = line
  if #log_lines > 500 then
    table.remove(log_lines, 1)
  end
end

function M.is_setup()
  return cfg ~= nil
end

--- The resolved configuration, for :checkhealth and for tests.
function M.config()
  return cfg
end

function M.log_text()
  return log_lines
end

-- --- finding manifests -------------------------------------------------------
--
-- The searching is discover.lua; these stay on the module because they are the
-- plugin's API -- :checkhealth and plugin/depwatch.lua both call them.

M.root = discover.root

function M.manifests()
  return discover.manifests(cfg)
end

function M.is_manifest(path)
  return discover.is_manifest(cfg, path)
end

--- The session, as commands.lua sees it.
local function context()
  return {
    cfg = cfg,
    grouping = function()
      return grouping
    end,
    set_grouping = function(mode)
      grouping = mode
    end,
    root = M.root,
    manifests = M.manifests,
    is_manifest = M.is_manifest,
    results = M.results,
    scan_of = function(path)
      return results[path]
    end,
    totals = M.totals,
    scan = M.scan,
    scan_all = M.scan_all,
    log_lines = function()
      return log_lines
    end,
    log = log,
  }
end

-- --- running depwatch --------------------------------------------------------

--- Argv for one manifest's scan.
---
--- `--accepted` is named only when the file is actually there: an explicit flag
--- pointing at nothing is an error to the CLI, and "no baseline yet" is the
--- normal case, not a failure.
local function scan_argv(path, opts)
  local baseline = vim.fs.joinpath(M.root(), cfg.baseline.path)
  return core.check_argv(
    cfg,
    path,
    vim.tbl_extend('force', opts, { baseline = vim.uv.fs_stat(baseline) and baseline or nil })
  )
end

--- The CLI said nothing usable. A manifest with no dependencies is a normal
--- thing to have -- a tooling package.json, an empty requirements.txt -- and
--- listing every one of them as a problem would bury the manifests that
--- genuinely could not be read.
local function scan_failed(path, label, opts, out, err)
  if ((out.stderr or '') .. (err or '')):match('no dependencies found') then
    results[path] = nil
    ui.clear(path)
    log('%s: no dependencies', label)
    return
  end
  log('%s: %s', label, (err or out.stderr or 'failed'):gsub('%s+$', ''))
  if opts.notify then
    notify(label .. ': ' .. vim.split(err or out.stderr or 'failed', '\n')[1], vim.log.levels.WARN)
  end
end

--- A decoded report, kept and drawn.
local function scan_succeeded(path, label, opts, report)
  results[path] = {
    path = path,
    label = label,
    report = report,
    deep = opts.deep or cfg.deep,
    scanned_at = os.time(),
  }
  log('%s: %.2f libyears, %d deps', label, report.totalLibyears, #report.deps)
  ui.render(path, report, cfg)
end

--- Everything one finished subprocess means. Returns whether it produced a
--- report, which is what `on_done` is told.
local function scan_finished(path, label, opts, out)
  local report, err = cli.decode(out)
  if not report then
    scan_failed(path, label, opts, out, err)
    return false
  end
  if not core.is_report(report) then
    log('%s: not a depwatch report', label)
    if opts.notify then
      notify(label .. ': unexpected output — is `cmd` pointing at depwatch?', vim.log.levels.ERROR)
    end
    return false
  end
  scan_succeeded(path, label, opts, report)
  return true
end

--- Scan one manifest.
function M.scan(path, opts)
  opts = opts or {}
  if not cfg.enabled then
    return
  end
  path = vim.fs.normalize(path)
  if running[path] then
    return -- one scan per manifest at a time; the newest save already has one
  end

  local label = vim.fs.relpath(M.root(), path) or path
  running[path] = true
  local handle = cli.run(context(), scan_argv(path, opts), function(out)
    running[path] = nil
    local ok = scan_finished(path, label, opts, out)
    if opts.on_done then
      opts.on_done(ok)
    end
  end)
  if handle then
    running[path] = handle
  end
end

--- Scan every manifest in the project.
function M.scan_all(opts)
  opts = opts or {}
  if not cfg.enabled then
    return
  end
  local found = M.manifests()
  if #found == 0 then
    if opts.notify then
      notify('no dependency manifests found in this project.')
    end
    return
  end
  log('scanning %d manifest(s)', #found)
  local pending = #found
  for _, path in ipairs(found) do
    M.scan(path, vim.tbl_extend('force', opts, {
      on_done = function()
        pending = pending - 1
        if pending == 0 and opts.on_all_done then
          opts.on_all_done()
        end
      end,
    }))
  end
end

function M.cancel()
  local n = 0
  for path, handle in pairs(running) do
    if type(handle) == 'table' then
      pcall(function()
        handle:kill('sigterm')
      end)
    end
    running[path] = nil
    n = n + 1
  end
  notify(n == 0 and 'no scan is running.' or string.format('cancelled %d scan(s).', n))
end

-- --- what the last scan found ------------------------------------------------

--- Every scan, ordered by label.
function M.results()
  local out = {}
  for _, scan in pairs(results) do
    out[#out + 1] = scan
  end
  table.sort(out, function(a, b)
    return a.label < b.label
  end)
  return out
end

--- The scan a given file belongs to: the manifest itself, or the nearest one
--- above it, so there is something to say while editing source too.
function M.result_for(path)
  path = vim.fs.normalize(path or vim.api.nvim_buf_get_name(0))
  if results[path] then
    return results[path]
  end
  local best
  for candidate, scan in pairs(results) do
    local dir = vim.fs.dirname(candidate)
    if path:sub(1, #dir + 1) == dir .. '/' then
      if not best or #dir > #vim.fs.dirname(best.path) then
        best = scan
      end
    end
  end
  return best
end

function M.totals()
  local reports = {}
  for _, scan in ipairs(M.results()) do
    reports[#reports + 1] = scan.report
  end
  return core.totals(reports)
end

--- A lualine component, or anything else that wants one string.
function M.statusline()
  if not cfg or vim.tbl_isempty(results) then
    return ''
  end
  local totals = M.totals()
  if totals.to_address == 0 then
    return string.format('%.2f ly', totals.libyears)
  end
  return string.format('%.2f ly · %d', totals.libyears, totals.to_address)
end

-- --- commands ----------------------------------------------------------------
--
-- What each one does is in commands.lua; the session it acts on is here. The
-- public names are the plugin's API and its user commands both, so they stay
-- exactly as they are and hand the context over.

-- One shape for all of them, rather than ten copies of it: every command takes
-- the session and whatever the user command passed. The names are the plugin's
-- API and its :Depwatch* commands both, so the list is the contract -- see
-- commands.lua for what each one does, and doc/depwatch.txt for the arguments.
for _, name in ipairs({
  'report',
  'group_by',
  'gates',
  'trend',
  'write_baseline',
  'clear_baseline',
  'list',
  'filter',
  'hover',
  'show_log',
}) do
  M[name] = function(...)
    return commands[name](context(), ...)
  end
end

-- --- setup -------------------------------------------------------------------

function M.setup(opts)
  cfg = config.resolve(opts)
  grouping = cfg.report.group_by
  if not cfg.enabled then
    ui.clear_all()
    return
  end
  triggers.attach(context)
  triggers.arm_refresh(context)
  if cfg.scan.on_startup then
    vim.schedule(function()
      M.scan_all({})
    end)
  end
end

return M
