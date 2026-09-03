-- The user commands, and the pickers in front of them.
--
-- Nothing here keeps state: `ctx` is the session -- its configuration, what the
-- last scan found, and the two calls that reach the CLI -- handed over by
-- init.lua, which owns all of it. That keeps a command readable on its own and
-- keeps one copy of the state, where the scan policy can see it.
--
---@class DepwatchContext
---@field cfg table the resolved configuration
---@field grouping fun():string how the report is bucketed this session
---@field set_grouping fun(mode:string)
---@field root fun():string
---@field manifests fun():string[]
---@field is_manifest fun(path:string):boolean
---@field results fun():table[] every scan, ordered by label
---@field scan_of fun(path:string):table|nil the scan of exactly this file
---@field totals fun():table
---@field scan fun(path:string, opts:table)
---@field scan_all fun(opts:table)
---@field log_lines fun():string[]
---@field log fun(fmt:string, ...any) append a line to the plugin's own log

local cli = require('depwatch.cli')
local core = require('depwatch.core')
local notify = require('depwatch.notify')
local quickfix = require('depwatch.quickfix')
local ui = require('depwatch.ui')

local M = {}

--- What each axis answers, for the picker. depwatch has no rule engine to group
--- by -- the two axes are measured, not asserted -- so severity is the quadrant
--- and ecosystem is the third real axis.
local GROUP_BLURB = {
  file = 'what is wrong in each manifest',
  severity = 'what is worst, across every manifest',
  ecosystem = 'which registry the drift is coming from',
}
--- The manifest a command should act on: the current buffer when it is one,
--- otherwise the only one, otherwise ask.
local function pick_manifest(ctx, cb)
  local current = vim.fs.normalize(vim.api.nvim_buf_get_name(0))
  if current ~= '' and ctx.is_manifest(current) then
    return cb(current)
  end
  local scans = ctx.results()
  local paths = {}
  for _, scan in ipairs(scans) do
    paths[#paths + 1] = scan.path
  end
  if #paths == 0 then
    paths = ctx.manifests()
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
      return vim.fs.relpath(ctx.root(), path) or path
    end,
  }, function(choice)
    if choice then
      cb(choice)
    end
  end)
end

local function ensure_scanned(ctx, cb)
  if #ctx.results() > 0 then
    return cb()
  end
  notify('scanning…')
  ctx.scan_all({ on_all_done = cb })
end

--- The report, in a float.
function M.report(ctx)
  ensure_scanned(ctx, function()
    local scans = ctx.results()
    if #scans == 0 then
      return notify('nothing scanned yet.', vim.log.levels.WARN)
    end
    ui.float(ui.report_lines(scans, ctx.grouping()), {
      title = string.format(' depwatch report — by %s ', ctx.grouping()),
      filetype = 'depwatch-report',
    })
  end)
end

--- How the report buckets its rows. Config sets the default and this changes it
--- for the session: like the filter, it is a way of looking at today's report
--- rather than a setting worth persisting.
function M.group_by(ctx, mode)
  if mode == nil or mode == '' then
    return vim.ui.select(core.GROUP_BY, {
      prompt = 'Group the report by',
      format_item = function(item)
        return string.format('%-10s %s', item, GROUP_BLURB[item])
      end,
    }, function(choice)
      if choice then
        M.group_by(ctx, choice)
      end
    end)
  end
  if not vim.tbl_contains(core.GROUP_BY, mode) then
    return notify(
      string.format('cannot group by "%s" — try %s.', mode, table.concat(core.GROUP_BY, ', ')),
      vim.log.levels.WARN
    )
  end
  ctx.set_grouping(mode)
  M.report(ctx)
end

--- The editor's copy of `depwatch check --ci`.
function M.gates(ctx)
  if ctx.cfg.gates.max_libyears == nil and ctx.cfg.gates.max_replace == nil then
    return notify(
      'no gates configured. Set gates.max_libyears or gates.max_replace to fail on a budget, '
        .. 'the same way `depwatch check --ci` does.',
      vim.log.levels.WARN
    )
  end
  ensure_scanned(ctx, function()
    local failures = {}
    for _, scan in ipairs(ctx.results()) do
      for _, failure in ipairs(core.gate_failures(scan.report, ctx.cfg.gates)) do
        failures[#failures + 1] = scan.label .. ': ' .. failure.message
      end
    end
    if #failures == 0 then
      return notify('gates pass.')
    end
    notify(string.format('%d gate(s) failing —\n%s', #failures, table.concat(failures, '\n')), vim.log.levels.WARN)
  end)
end

--- One row per sampled commit, and the drift between the ends. Two commits are
--- the fewest that have a "between", so a single point gets no delta line.
local function trend_lines(label, points)
  local lines = { '# ' .. label, '' }
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
  if #points > 1 then
    local delta = points[#points].totalLibyears - points[1].totalLibyears
    lines[#lines + 1] = ''
    lines[#lines + 1] = string.format(
      '%s%.2f libyears over %d sampled commits',
      delta >= 0 and '+' or '',
      delta,
      #points
    )
  end
  return lines
end

--- Drift over the manifest's git history.
function M.trend(ctx)
  pick_manifest(ctx, function(path)
    local label = vim.fs.relpath(ctx.root(), path) or path
    notify('reading history of ' .. label .. '…')
    cli.run(ctx, core.trend_argv(ctx.cfg, path), function(out)
      local points, err = cli.decode(out)
      if not points or type(points) ~= 'table' or #points == 0 then
        return notify(err or (out.stderr ~= '' and out.stderr) or 'no history for that manifest.', vim.log.levels.WARN)
      end
      ui.float(trend_lines(label, points), { title = ' depwatch trend ' })
    end)
  end)
end

--- Accept everything currently found. Writes the same file
--- `depwatch check --accepted` reads, so CI and the editor agree.
function M.write_baseline(ctx)
  pick_manifest(ctx, function(path)
    cli.run(ctx, core.write_baseline_argv(ctx.cfg, path), function(out)
      local message = (out.stderr or ''):gsub('%s+$', '')
      if out.code ~= 0 then
        return notify(message ~= '' and message or 'could not write the baseline.', vim.log.levels.ERROR)
      end
      notify(message ~= '' and message:gsub('^depwatch: ', '') or ('wrote ' .. ctx.cfg.baseline.path))
      ctx.scan(path, {})
    end)
  end)
end

function M.clear_baseline(ctx)
  local target = vim.fs.joinpath(ctx.root(), ctx.cfg.baseline.path)
  if vim.uv.fs_stat(target) == nil then
    return notify('there was no baseline to clear.')
  end
  local ok, err = vim.uv.fs_unlink(target)
  if not ok then
    return notify('could not remove the baseline: ' .. tostring(err), vim.log.levels.ERROR)
  end
  notify('baseline cleared. Every finding is shown again.')
  ctx.scan_all({})
end

-- --- the quickfix list -------------------------------------------------------

--- Every finding, in the quickfix list. See quickfix.lua for what a row says.
function M.list(ctx, opts)
  opts = opts or {}
  ensure_scanned(ctx, function()
    quickfix.list(ctx.results(), ctx.cfg.thresholds, opts.all)
  end)
end

--- Show only some quadrants.
function M.filter(ctx)
  quickfix.filter(ctx.results, ctx.cfg.thresholds, ctx.totals())
end

--- What depwatch knows about the dependency under the cursor.
function M.hover(ctx)
  local path = vim.fs.normalize(vim.api.nvim_buf_get_name(0))
  local scan = ctx.scan_of(path)
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
      return ui.hover(core.hover_lines(dep, ctx.cfg.thresholds, scan.report.ecosystem))
    end
  end
  notify('no dependency on this line.')
end

function M.show_log(ctx)
  local log_lines = ctx.log_lines()
  ui.float(#log_lines > 0 and log_lines or { 'nothing logged yet' }, { title = ' depwatch log ', filetype = 'log' })
end

return M
