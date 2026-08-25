-- User commands only.
--
-- Deliberately cheap: nothing here requires core.lua, so a session that never
-- opens a manifest never loads the plugin. Every command resolves the module on
-- first use.

if vim.g.loaded_depwatch then
  return
end
vim.g.loaded_depwatch = true

local function depwatch()
  return require('depwatch')
end

--- setup() is optional: a command used before it runs gets the defaults rather
--- than an error about a nil config.
local function ready()
  local dw = depwatch()
  if not dw.is_setup() then
    dw.setup({})
  end
  return dw
end

local command = vim.api.nvim_create_user_command

command('DepwatchScan', function()
  local dw = ready()
  local path = vim.fs.normalize(vim.api.nvim_buf_get_name(0))
  if path ~= '' and dw.is_manifest(path) then
    dw.scan(path, { notify = true })
  else
    dw.scan_all({ notify = true })
  end
end, { desc = 'depwatch: scan the current manifest, or the project' })

command('DepwatchScanAll', function()
  ready().scan_all({ notify = true })
end, { desc = 'depwatch: scan every manifest in the project' })

command('DepwatchDeepScan', function()
  ready().scan_all({ notify = true, deep = true })
end, { desc = 'depwatch: scan with maintainer, archived and last-commit signals' })

command('DepwatchReport', function()
  ready().report()
end, { desc = 'depwatch: open the report' })

command('DepwatchTrend', function()
  ready().trend()
end, { desc = 'depwatch: drift over git history' })

command('DepwatchGates', function()
  ready().gates()
end, { desc = 'depwatch: check the CI gates' })

command('DepwatchList', function(opts)
  ready().list({ all = opts.bang })
end, { bang = true, desc = 'depwatch: every finding, in the quickfix list (! for healthy too)' })

command('DepwatchFilter', function()
  ready().filter()
end, { desc = 'depwatch: list findings for one quadrant' })

command('DepwatchGroupBy', function(opts)
  ready().group_by(opts.args)
end, {
  nargs = '?',
  -- Neovim does not filter a function completion's return value, so the lead is
  -- matched here rather than offering all three whatever has been typed.
  complete = function(lead)
    return vim.tbl_filter(function(mode)
      return mode:find(lead, 1, true) == 1
    end, require('depwatch.core').GROUP_BY)
  end,
  desc = 'depwatch: group the report by file, severity or ecosystem',
})

command('DepwatchHover', function()
  ready().hover()
end, { desc = 'depwatch: explain the dependency under the cursor' })

command('DepwatchBaselineWrite', function()
  ready().write_baseline()
end, { desc = 'depwatch: accept current findings (write baseline)' })

command('DepwatchBaselineClear', function()
  ready().clear_baseline()
end, { desc = 'depwatch: clear the baseline' })

command('DepwatchCancel', function()
  ready().cancel()
end, { desc = 'depwatch: cancel the running scan' })

command('DepwatchLog', function()
  ready().show_log()
end, { desc = 'depwatch: show the log' })
