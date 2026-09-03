-- Reaching depwatch itself.
--
-- One subprocess per command, never blocking: `vim.system` with a callback, and
-- everything that touches the editor is scheduled. Nothing here knows what a
-- report means -- it runs a command line and hands back what came out.

local notify = require('depwatch.notify')

local M = {}

--- Said once per session: a missing depwatch is the single most likely thing to
--- be wrong, and repeating it on every scan of every manifest is not help.
local missing_reported = false

--- Run the CLI and hand the finished process to `cb`.
---
--- Returns the handle, or nil when the command could not be started at all --
--- vim.system raises for a missing executable, and a missing depwatch must not
--- be a traceback on startup. `cb` is still called, with a synthetic failure, so
--- one caller does not have to handle two shapes of "it did not work".
---@param ctx DepwatchContext
function M.run(ctx, argv, cb)
  local cfg = ctx.cfg
  local cmd = vim.list_extend(vim.list_slice(cfg.cmd, 1, #cfg.cmd), argv)
  ctx.log('run: %s', table.concat(cmd, ' '))
  local ok, handle = pcall(vim.system, cmd, {
    text = true,
    cwd = ctx.root(),
    timeout = cfg.scan.timeout_ms,
  }, function(out)
    vim.schedule(function()
      cb(out)
    end)
  end)
  if ok then
    return handle
  end
  ctx.log('could not run %s: %s', cmd[1], tostring(handle))
  if not missing_reported then
    missing_reported = true
    notify(('could not run `%s` — see :checkhealth depwatch'):format(cmd[1]), vim.log.levels.ERROR)
  end
  vim.schedule(function()
    cb({ code = -1, stdout = '', stderr = tostring(handle) })
  end)
  return nil
end

--- The JSON depwatch printed, or nil and a line saying why not.
function M.decode(out)
  if out.stdout == nil or out.stdout == '' then
    return nil, (out.stderr ~= '' and out.stderr or 'depwatch produced no output')
  end
  local ok, value = pcall(vim.json.decode, out.stdout)
  if not ok then
    return nil, 'could not read depwatch output as JSON: ' .. tostring(value)
  end
  return value, nil
end

return M
