-- setup(), the public API, and the scan policy.
--
-- The policy is deliberately dull: on startup, when a manifest is written, on a
-- slow timer, or when asked. Never while you type. Every scan is a subprocess
-- run through vim.system with a callback, so nothing here blocks the UI.

local config = require('depwatch.config')
local core = require('depwatch.core')
local ui = require('depwatch.ui')

local M = {}

---@type table|nil
local cfg = nil

--- path -> { label, report, scanned_at, deep }
local results = {}
--- Scans in flight, so they can be cancelled and so a second save does not
--- start a duplicate.
local running = {}
local timers = {}
local refresh_timer = nil
local log_lines = {}
--- The report's grouping for this session. Set from config at setup.
local grouping = 'file'

--- What each axis answers, for the picker. depwatch has no rule engine to group
--- by -- the two axes are measured, not asserted -- so severity is the quadrant
--- and ecosystem is the third real axis.
local GROUP_BLURB = {
  file = 'what is wrong in each manifest',
  severity = 'what is worst, across every manifest',
  ecosystem = 'which registry the drift is coming from',
}

local function log(fmt, ...)
  local line = string.format('[%s] ' .. fmt, os.date('%H:%M:%S'), ...)
  log_lines[#log_lines + 1] = line
  if #log_lines > 500 then
    table.remove(log_lines, 1)
  end
end

local function notify(msg, level)
  vim.notify('depwatch: ' .. msg, level or vim.log.levels.INFO)
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

function M.root()
  return vim.fs.root(0, { '.git', '.hg', 'package.json', 'Cargo.toml', 'go.mod' }) or vim.uv.cwd()
end

--- Manifests worth scanning, shallowest first: in a monorepo the root manifest
--- is the one someone means.
function M.manifests()
  local root = M.root()
  local skip = {}
  for _, name in ipairs(cfg.exclude) do
    skip[name] = true
  end
  local wanted = {}
  for _, name in ipairs(cfg.manifests) do
    wanted[name] = true
  end

  local found = vim.fs.find(function(name, path)
    if not wanted[name] then
      return false
    end
    for segment in path:gmatch('[^/]+') do
      if skip[segment] then
        return false
      end
    end
    return true
  end, { path = root, type = 'file', limit = cfg.max_manifests * 4 })

  table.sort(found, function(a, b)
    local da = select(2, a:gsub('/', ''))
    local db = select(2, b:gsub('/', ''))
    if da ~= db then
      return da < db
    end
    return a < b
  end)
  return vim.list_slice(found, 1, cfg.max_manifests)
end

--- Is this a file we would scan?
function M.is_manifest(path)
  local base = core.basename(path)
  for _, name in ipairs(cfg.manifests) do
    if base == name then
      return true
    end
  end
  return false
end

-- --- running depwatch --------------------------------------------------------

--- Run the CLI and hand the decoded JSON to `cb`. Never blocks: `vim.system`
--- with a callback, and everything that touches the editor is scheduled.
local missing_reported = false

local function run(argv, cb)
  local cmd = vim.list_extend(vim.list_slice(cfg.cmd, 1, #cfg.cmd), argv)
  log('run: %s', table.concat(cmd, ' '))
  -- vim.system raises when the executable is not there, and a missing depwatch
  -- must not be a traceback on startup -- it is the single most likely thing to
  -- be wrong, and :checkhealth is where it is explained.
  local ok, handle = pcall(vim.system, cmd, {
    text = true,
    cwd = M.root(),
    timeout = cfg.scan.timeout_ms,
  }, function(out)
    vim.schedule(function()
      cb(out)
    end)
  end)
  if ok then
    return handle
  end
  log('could not run %s: %s', cmd[1], tostring(handle))
  if not missing_reported then
    missing_reported = true
    notify(
      ('could not run `%s` — see :checkhealth depwatch'):format(cmd[1]),
      vim.log.levels.ERROR
    )
  end
  vim.schedule(function()
    cb({ code = -1, stdout = '', stderr = tostring(handle) })
  end)
  return nil
end

local function decode(out)
  if out.stdout == nil or out.stdout == '' then
    return nil, (out.stderr ~= '' and out.stderr or 'depwatch produced no output')
  end
  local ok, value = pcall(vim.json.decode, out.stdout)
  if not ok then
    return nil, 'could not read depwatch output as JSON: ' .. tostring(value)
  end
  return value, nil
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
  -- Only when it is actually there: `--accepted` naming a missing file is an
  -- error to the CLI, and "no baseline yet" is the normal case, not a failure.
  local baseline = vim.fs.joinpath(M.root(), cfg.baseline.path)
  local argv = core.check_argv(
    cfg,
    path,
    vim.tbl_extend('force', opts, { baseline = vim.uv.fs_stat(baseline) and baseline or nil })
  )
  running[path] = true
  local handle = run(argv, function(out)
    running[path] = nil
    local report, err = decode(out)

    if not report then
      -- A manifest with no dependencies is a normal thing to have -- a tooling
      -- package.json, an empty requirements.txt -- and listing every one of
      -- them as a problem would bury the ones that genuinely could not be read.
      local text = (out.stderr or '') .. (err or '')
      if text:match('no dependencies found') then
        results[path] = nil
        ui.clear(path)
        log('%s: no dependencies', label)
      else
        log('%s: %s', label, (err or out.stderr or 'failed'):gsub('%s+$', ''))
        if opts.notify then
          notify(label .. ': ' .. vim.split(err or out.stderr or 'failed', '\n')[1], vim.log.levels.WARN)
        end
      end
      if opts.on_done then
        opts.on_done(false)
      end
      return
    end

    if not core.is_report(report) then
      log('%s: not a depwatch report', label)
      if opts.notify then
        notify(label .. ': unexpected output — is `cmd` pointing at depwatch?', vim.log.levels.ERROR)
      end
      if opts.on_done then
        opts.on_done(false)
      end
      return
    end

    results[path] = {
      path = path,
      label = label,
      report = report,
      deep = opts.deep or cfg.deep,
      scanned_at = os.time(),
    }
    log('%s: %.2f libyears, %d deps', label, report.totalLibyears, #report.deps)
    ui.render(path, report, cfg)
    if opts.on_done then
      opts.on_done(true)
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

-- --- triggers ----------------------------------------------------------------

local function debounce(key, ms, fn)
  if timers[key] then
    timers[key]:stop()
    timers[key]:close()
  end
  local timer = vim.uv.new_timer()
  timers[key] = timer
  timer:start(ms, 0, function()
    timer:stop()
    timer:close()
    timers[key] = nil
    vim.schedule(fn)
  end)
end

local function arm_refresh()
  if refresh_timer then
    refresh_timer:stop()
    refresh_timer:close()
    refresh_timer = nil
  end
  local minutes = cfg.scan.refresh_minutes
  if minutes <= 0 then
    return
  end
  refresh_timer = vim.uv.new_timer()
  refresh_timer:start(minutes * 60000, minutes * 60000, function()
    vim.schedule(function()
      log('periodic refresh')
      M.scan_all({})
    end)
  end)
end

local function attach_autocmds()
  local group = vim.api.nvim_create_augroup('depwatch', { clear = true })

  vim.api.nvim_create_autocmd('BufWritePost', {
    group = group,
    callback = function(event)
      if not cfg.enabled or not cfg.scan.on_save then
        return
      end
      local path = vim.fs.normalize(event.match)
      if M.is_manifest(path) then
        debounce(path, cfg.scan.debounce_ms, function()
          M.scan(path, {})
        end)
      end
    end,
  })

  -- A manifest opened after its scan still gets its marks.
  vim.api.nvim_create_autocmd('BufReadPost', {
    group = group,
    callback = function(event)
      local scan = results[vim.fs.normalize(event.match)]
      if scan then
        vim.schedule(function()
          ui.render(scan.path, scan.report, cfg)
        end)
      end
    end,
  })
end


-- --- commands ----------------------------------------------------------------

--- The manifest a command should act on: the current buffer when it is one,
--- otherwise the only one, otherwise ask.
local function pick_manifest(cb)
  local current = vim.fs.normalize(vim.api.nvim_buf_get_name(0))
  if current ~= '' and M.is_manifest(current) then
    return cb(current)
  end
  local scans = M.results()
  local paths = {}
  for _, scan in ipairs(scans) do
    paths[#paths + 1] = scan.path
  end
  if #paths == 0 then
    paths = M.manifests()
  end
  if #paths == 0 then
    notify('no dependency manifest found.', vim.log.levels.WARN)
    return
  end
  if #paths == 1 then
    return cb(paths[1])
  end
  vim.ui.select(paths, {
    prompt = 'Which manifest?',
    format_item = function(path)
      return vim.fs.relpath(M.root(), path) or path
    end,
  }, function(choice)
    if choice then
      cb(choice)
    end
  end)
end

local function ensure_scanned(cb)
  if not vim.tbl_isempty(results) then
    return cb()
  end
  notify('scanning…')
  M.scan_all({ on_all_done = cb })
end

--- The report, in a float.
function M.report()
  ensure_scanned(function()
    local scans = M.results()
    if #scans == 0 then
      return notify('nothing scanned yet.', vim.log.levels.WARN)
    end
    ui.float(ui.report_lines(scans, grouping), {
      title = string.format(' depwatch report — by %s ', grouping),
      filetype = 'depwatch-report',
    })
  end)
end

--- How the report buckets its rows. Config sets the default and this changes it
--- for the session: like the filter, it is a way of looking at today's report
--- rather than a setting worth persisting.
function M.group_by(mode)
  if mode == nil or mode == '' then
    return vim.ui.select(core.GROUP_BY, {
      prompt = 'Group the report by',
      format_item = function(item)
        return string.format('%-10s %s', item, GROUP_BLURB[item])
      end,
    }, function(choice)
      if choice then
        M.group_by(choice)
      end
    end)
  end
  if not vim.tbl_contains(core.GROUP_BY, mode) then
    return notify(
      string.format('cannot group by "%s" — try %s.', mode, table.concat(core.GROUP_BY, ', ')),
      vim.log.levels.WARN
    )
  end
  grouping = mode
  M.report()
end

--- The editor's copy of `depwatch check --ci`.
function M.gates()
  if cfg.gates.max_libyears == nil and cfg.gates.max_replace == nil then
    return notify(
      'no gates configured. Set gates.max_libyears or gates.max_replace to fail on a budget, '
        .. 'the same way `depwatch check --ci` does.',
      vim.log.levels.WARN
    )
  end
  ensure_scanned(function()
    local failures = {}
    for _, scan in ipairs(M.results()) do
      for _, failure in ipairs(core.gate_failures(scan.report, cfg.gates)) do
        failures[#failures + 1] = scan.label .. ': ' .. failure.message
      end
    end
    if #failures == 0 then
      return notify('gates pass.')
    end
    notify(string.format('%d gate(s) failing —\n%s', #failures, table.concat(failures, '\n')), vim.log.levels.WARN)
  end)
end

--- Drift over the manifest's git history.
function M.trend()
  pick_manifest(function(path)
    notify('reading history of ' .. (vim.fs.relpath(M.root(), path) or path) .. '…')
    run(core.trend_argv(cfg, path), function(out)
      local points, err = decode(out)
      if not points or type(points) ~= 'table' or #points == 0 then
        return notify(err or (out.stderr ~= '' and out.stderr) or 'no history for that manifest.', vim.log.levels.WARN)
      end
      local lines = { '# ' .. (vim.fs.relpath(M.root(), path) or path), '' }
      for _, point in ipairs(points) do
        lines[#lines + 1] = string.format(
          '%s  %s  %8.2f libyears  %4d deps  %d replace',
          point.date:sub(1, 10),
          point.commit,
          point.totalLibyears,
          point.deps,
          point.replace
        )
      end
      local first, last = points[1], points[#points]
      if #points > 1 then
        local delta = last.totalLibyears - first.totalLibyears
        lines[#lines + 1] = ''
        lines[#lines + 1] = string.format(
          '%s%.2f libyears over %d sampled commits',
          delta >= 0 and '+' or '',
          delta,
          #points
        )
      end
      ui.float(lines, { title = ' depwatch trend ' })
    end)
  end)
end

--- Accept everything currently found. Writes the same file
--- `depwatch check --accepted` reads, so CI and the editor agree.
function M.write_baseline()
  pick_manifest(function(path)
    run(core.write_baseline_argv(cfg, path), function(out)
      local message = (out.stderr or ''):gsub('%s+$', '')
      if out.code ~= 0 then
        return notify(message ~= '' and message or 'could not write the baseline.', vim.log.levels.ERROR)
      end
      notify(message ~= '' and message:gsub('^depwatch: ', '') or ('wrote ' .. cfg.baseline.path))
      M.scan(path, {})
    end)
  end)
end

function M.clear_baseline()
  local target = vim.fs.joinpath(M.root(), cfg.baseline.path)
  if vim.uv.fs_stat(target) == nil then
    return notify('there was no baseline to clear.')
  end
  local ok, err = vim.uv.fs_unlink(target)
  if not ok then
    return notify('could not remove the baseline: ' .. tostring(err), vim.log.levels.ERROR)
  end
  notify('baseline cleared. Every finding is shown again.')
  M.scan_all({})
end

-- --- the quickfix list -------------------------------------------------------

--- Quickfix's own severity letters, by quadrant. Not the configured diagnostic
--- severities: those decide what is worth underlining in a manifest, which is a
--- different question from how a list of findings sorts and colours.
local QF_TYPE = { replace = 'E', upgrade = 'W', watch = 'I', healthy = 'I', degraded = 'N' }

--- Findings as quickfix rows, on the line each dependency is actually written
--- on. The CLI reports names, not positions, so the manifest is indexed once
--- per scan -- the same index the marks and the hover use, so jumping from the
--- list lands where the underline is.
local function qf_items(scans, keep)
  local items = {}
  for _, scan in ipairs(scans) do
    local names = {}
    for _, dep in ipairs(scan.report.deps or {}) do
      names[#names + 1] = dep.name
    end
    local text = ui.text_of(scan.path)
    local spans = text and core.locate(text, scan.path, names) or {}

    for _, dep in ipairs(core.sorted_deps(scan.report)) do
      if keep(dep) then
        -- A transitive dep is written down nowhere in this manifest. It is
        -- still a finding, so it goes in the list pointing at the file itself
        -- rather than being dropped.
        local span = spans[dep.name]
        items[#items + 1] = {
          filename = scan.path,
          lnum = span and span.lnum + 1 or 1,
          col = span and span.col + 1 or 1,
          type = QF_TYPE[core.lens_of(dep)] or 'I',
          text = core.summarise(dep, cfg.thresholds),
        }
      end
    end
  end
  return items
end

local function to_quickfix(title, items, empty)
  if #items == 0 then
    return notify(empty)
  end
  vim.fn.setqflist({}, ' ', { title = title, items = items })
  vim.cmd('copen')
end

--- Every finding, in the quickfix list.
---
--- A healthy dependency is not a finding, so the default list is everything off
--- the healthy quadrant -- the same set the summary calls "to address". With a
--- bang, the whole dependency list, healthy ones included.
function M.list(opts)
  opts = opts or {}
  ensure_scanned(function()
    local keep = opts.all and function()
      return true
    end or function(dep)
      return core.lens_of(dep) ~= 'healthy'
    end
    to_quickfix(
      opts.all and 'depwatch: every dependency' or 'depwatch',
      qf_items(M.results(), keep),
      opts.all and 'nothing scanned yet.' or 'nothing to address.'
    )
  end)
end

--- Show only some quadrants. A filter is a way of looking at today's list, so
--- it is not persisted.
function M.filter()
  local totals = M.totals()
  local items = {}
  for _, lens in ipairs(core.LENSES) do
    local count = lens == 'degraded' and totals.degraded or (totals.counts[lens] or 0)
    items[#items + 1] = { lens = lens, count = count }
  end
  vim.ui.select(items, {
    prompt = 'Show findings for',
    format_item = function(item)
      return string.format('%-8s %3d — %s', core.LABEL[item.lens], item.count, core.BLURB[item.lens])
    end,
  }, function(choice)
    if not choice then
      return
    end
    to_quickfix(
      'depwatch: ' .. core.LABEL[choice.lens],
      qf_items(M.results(), function(dep)
        return core.lens_of(dep) == choice.lens
      end),
      'nothing in ' .. core.LABEL[choice.lens] .. '.'
    )
  end)
end

--- What depwatch knows about the dependency under the cursor.
function M.hover()
  local path = vim.fs.normalize(vim.api.nvim_buf_get_name(0))
  local scan = results[path]
  if not scan then
    return notify('this file has not been scanned.', vim.log.levels.WARN)
  end
  local text = table.concat(vim.api.nvim_buf_get_lines(0, 0, -1, false), '\n')
  local names = {}
  for _, dep in ipairs(scan.report.deps or {}) do
    names[#names + 1] = dep.name
  end
  local spans = core.locate(text, path, names)
  local lnum = vim.api.nvim_win_get_cursor(0)[1] - 1
  for _, dep in ipairs(scan.report.deps or {}) do
    local span = spans[dep.name]
    if span and span.lnum == lnum then
      return ui.hover(core.hover_lines(dep, cfg.thresholds, scan.report.ecosystem))
    end
  end
  notify('no dependency on this line.')
end

function M.show_log()
  ui.float(#log_lines > 0 and log_lines or { 'nothing logged yet' }, { title = ' depwatch log ', filetype = 'log' })
end

-- --- setup -------------------------------------------------------------------

function M.setup(opts)
  cfg = config.resolve(opts)
  grouping = cfg.report.group_by
  if not cfg.enabled then
    ui.clear_all()
    return
  end
  attach_autocmds()
  arm_refresh()
  if cfg.scan.on_startup then
    vim.schedule(function()
      M.scan_all({})
    end)
  end
end

return M
