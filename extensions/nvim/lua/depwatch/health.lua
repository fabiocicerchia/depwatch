-- :checkhealth depwatch
--
-- The one question a scan cannot answer for you is why it produced nothing at
-- all, so that is what this checks: is depwatch there, does it run, does this
-- project have anything to measure.

local M = {}

local function version_of(cmd)
  local ok, out = pcall(function()
    return vim.system(vim.list_extend(vim.list_slice(cmd, 1, #cmd), { '--help' }), { text = true }):wait(5000)
  end)
  if not ok then
    return nil, tostring(out)
  end
  if out.code ~= 0 and (out.stdout or '') == '' then
    return nil, (out.stderr ~= '' and out.stderr or ('exited ' .. tostring(out.code)))
  end
  return (out.stdout or '') .. (out.stderr or ''), nil
end

--- The configuration to check against: the resolved one, or the defaults when
--- setup() has not run, so :checkhealth still answers rather than erroring.
local function configuration(depwatch)
  local cfg = depwatch.config()
  if cfg then
    return cfg
  end
  vim.health.info('setup() has not run yet; checking against the defaults')
  return require('depwatch.config').resolve({})
end

local function check_editor()
  if vim.fn.has('nvim-0.11') ~= 1 then
    vim.health.error('Neovim 0.11 or newer is required (vim.system, vim.fs.relpath, vim.validate).')
  else
    vim.health.ok('Neovim ' .. tostring(vim.version()))
  end
end

--- What the CLI's own help says about itself, once it is known to run.
local function check_help(shown, help)
  if not help:match('depwatch') then
    return vim.health.warn(('`%s` ran, but does not look like depwatch'):format(shown))
  end
  vim.health.ok(('`%s` runs'):format(shown))
  -- --accepted is what makes a committed baseline work in the editor as well
  -- as in CI; an older build simply has no baseline support.
  if help:match('%-%-accepted') then
    vim.health.ok('this build supports --accepted')
  else
    vim.health.warn(
      'this build has no --accepted support',
      { 'Baseline commands will fail. Update depwatch to a build that has `check --accepted`.' }
    )
  end
end

--- The CLI is the whole engine, so its absence is the single reason a board
--- ends up empty.
local function check_cli(cfg)
  local shown = table.concat(cfg.cmd, ' ')
  if vim.fn.executable(cfg.cmd[1]) ~= 1 then
    return vim.health.error(('`%s` is not executable'):format(cfg.cmd[1]), {
      'Install depwatch and put it on PATH, or point `cmd` at a checkout:',
      "  require('depwatch').setup({ cmd = { 'node', '/path/to/depwatch/dist/cli.js' } })",
    })
  end
  local help, err = version_of(cfg.cmd)
  if not help then
    return vim.health.error(('`%s` did not run: %s'):format(shown, err))
  end
  check_help(shown, help)
end

local function check_manifests(depwatch, root)
  local found = depwatch.manifests()
  if #found == 0 then
    return vim.health.warn('no dependency manifests found under this root', {
      'Check `manifests` and `exclude` in your setup() call.',
    })
  end
  local names = {}
  for _, path in ipairs(found) do
    names[#names + 1] = vim.fs.relpath(root, path) or path
  end
  vim.health.ok(('%d manifest(s): %s'):format(#found, table.concat(names, ', ')))
end

local function check_baseline(cfg, root)
  if vim.uv.fs_stat(vim.fs.joinpath(tostring(root), cfg.baseline.path)) then
    vim.health.ok('baseline: ' .. cfg.baseline.path .. ' (findings it accepts are hidden)')
  else
    vim.health.info('baseline: none at ' .. cfg.baseline.path)
  end
end

local function check_deep(cfg)
  if cfg.deep and (vim.env.GITHUB_TOKEN or '') == '' then
    vim.health.warn('deep scans are on but GITHUB_TOKEN is unset', {
      'GitHub rate-limits anonymous requests hard; deep signals will often be missing.',
    })
  end
end

function M.check()
  vim.health.start('depwatch')

  local depwatch = require('depwatch')
  local cfg = configuration(depwatch)
  check_editor()
  check_cli(cfg)

  local root = depwatch.is_setup() and depwatch.root() or vim.uv.cwd()
  vim.health.info('project root: ' .. tostring(root))
  if depwatch.is_setup() then
    check_manifests(depwatch, root)
  end

  check_baseline(cfg, root)
  check_deep(cfg)
end

return M
