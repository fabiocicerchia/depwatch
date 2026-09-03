-- When a scan happens without being asked for.
--
-- Deliberately dull: when a manifest is written, and on a slow timer. Never
-- while you type -- BufWritePost, not TextChanged -- and a burst of writes
-- costs one scan, because the debounce is what stops `:wall` in a monorepo from
-- starting twenty subprocesses.
--
-- The timers are this module's own state: nothing else needs to know a scan is
-- pending, and a timer left behind is a scan that fires after :DepwatchDisable.

local ui = require('depwatch.ui')

local M = {}

--- Pending per-manifest debounces, by path.
local timers = {}
local refresh_timer = nil

--- Run `fn` once the writes stop, replacing any earlier wait on the same key.
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

--- The periodic re-check, which catches releases published elsewhere. Rearmed
--- from scratch each time, so a changed interval takes effect at once and 0
--- turns it off.
---@param context fun():DepwatchContext
function M.arm_refresh(context)
  if refresh_timer then
    refresh_timer:stop()
    refresh_timer:close()
    refresh_timer = nil
  end
  local minutes = context().cfg.scan.refresh_minutes
  if minutes <= 0 then
    return
  end
  refresh_timer = vim.uv.new_timer()
  refresh_timer:start(minutes * 60000, minutes * 60000, function()
    vim.schedule(function()
      local ctx = context()
      ctx.log('periodic refresh')
      ctx.scan_all({})
    end)
  end)
end

---@param context fun():DepwatchContext
function M.attach(context)
  local group = vim.api.nvim_create_augroup('depwatch', { clear = true })

  vim.api.nvim_create_autocmd('BufWritePost', {
    group = group,
    callback = function(event)
      local ctx = context()
      if not ctx.cfg.enabled or not ctx.cfg.scan.on_save then
        return
      end
      local path = vim.fs.normalize(event.match)
      if ctx.is_manifest(path) then
        debounce(path, ctx.cfg.scan.debounce_ms, function()
          context().scan(path, {})
        end)
      end
    end,
  })

  -- A manifest opened after its scan still gets its marks.
  vim.api.nvim_create_autocmd('BufReadPost', {
    group = group,
    callback = function(event)
      local ctx = context()
      local scan = ctx.scan_of(vim.fs.normalize(event.match))
      if scan then
        vim.schedule(function()
          ui.render(scan.path, scan.report, ctx.cfg)
        end)
      end
    end,
  })
end

return M
