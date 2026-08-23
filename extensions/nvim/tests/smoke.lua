-- End-to-end: this plugin, the real CLI, a real manifest, nothing else on the
-- runtimepath. Run headless with `nvim --headless --clean -u tests/smoke.lua`.
--
-- The specs cover the ported logic in isolation; this covers the contract with
-- depwatch itself, which no amount of unit testing can.

local here = vim.fn.fnamemodify(vim.fn.resolve(debug.getinfo(1, 'S').source:sub(2)), ':p:h:h')
vim.opt.runtimepath:prepend(here)
vim.opt.swapfile = false
-- The runtimepath is added after startup, so plugin/ has already been walked;
-- source it explicitly, which is what a plugin manager does for you.
vim.cmd('runtime! plugin/depwatch.lua')

local repo = vim.fn.fnamemodify(here, ':h:h')
local cli = vim.env.DEPWATCH_CLI or (repo .. '/dist/cli.js')

local failures = {}
local function check(ok, what)
  print((ok and '  ok   ' or '  FAIL ') .. what)
  if not ok then
    failures[#failures + 1] = what
  end
end

-- A fixture with something to actually find: an unmaintained package and two
-- that are years behind.
local project = vim.fn.tempname()
vim.fn.mkdir(project, 'p')
vim.fn.writefile({
  '{',
  '  "name": "smoke",',
  '  "dependencies": {',
  '    "request": "2.88.0",',
  '    "lodash": "4.17.4"',
  '  }',
  '}',
}, project .. '/package.json')
vim.uv.chdir(project)

print('depwatch.nvim smoke test')
print('  cli:     ' .. cli)
print('  project: ' .. project)

local depwatch = require('depwatch')
depwatch.setup({
  cmd = { 'node', cli },
  scan = { on_startup = false, on_save = false },
  gates = { max_libyears = 5 },
})

check(depwatch.is_setup(), 'setup() resolved a config')
check(#depwatch.manifests() == 1, 'found exactly one manifest')

vim.cmd.edit(project .. '/package.json')
local buf = vim.api.nvim_get_current_buf()

local done = false
depwatch.scan(project .. '/package.json', {
  notify = true,
  on_done = function(ok)
    done = ok
  end,
})

-- The scan talks to real registries, so give it room; this is the only wait in
-- the plugin and it is in a test, not in a hot path.
vim.wait(120000, function()
  return done
end, 200)
check(done, 'the scan completed')

local scan = depwatch.result_for(project .. '/package.json')
check(scan ~= nil, 'a result was stored')

if scan then
  check(#scan.report.deps == 2, 'both dependencies were scored (got ' .. #scan.report.deps .. ')')
  check(scan.report.totalLibyears > 0, 'total drift is a real number')

  local totals = depwatch.totals()
  check(totals.to_address > 0, 'there is something to address')
  check(depwatch.statusline():match('ly') ~= nil, 'the statusline reads "' .. depwatch.statusline() .. '"')

  local diagnostics = vim.diagnostic.get(buf, { namespace = require('depwatch.ui').namespace })
  check(#diagnostics > 0, 'diagnostics were published (' .. #diagnostics .. ')')

  -- The whole point of locate(): the squiggle has to be on the line the
  -- dependency is written on, not on line 1.
  local placed = {}
  for _, d in ipairs(diagnostics) do
    placed[d.lnum] = true
  end
  check(placed[3] and placed[4], 'they landed on the dependency lines (3 and 4)')

  local marks = vim.api.nvim_buf_get_extmarks(buf, vim.api.nvim_create_namespace('depwatch.virt'), 0, -1, {})
  check(#marks > 0, 'virtual text was drawn (' .. #marks .. ')')

  local failing = require('depwatch.core').gate_failures(scan.report, { max_libyears = 5 })
  check(#failing > 0, 'the gate fails on this fixture, as it should')
end

-- Every command has to at least run without raising.
for _, cmd in ipairs({
  'DepwatchReport',
  'DepwatchGates',
  'DepwatchLog',
  'DepwatchHover',
  'DepwatchCancel',
}) do
  local ok, err = pcall(vim.cmd, cmd)
  check(ok, cmd .. (ok and '' or ': ' .. tostring(err)))
  pcall(vim.cmd, 'close')
end

-- The baseline round-trip, which needs the CLI's --accepted support.
local wrote = false
depwatch.write_baseline()
vim.wait(60000, function()
  wrote = vim.uv.fs_stat(project .. '/.depwatch-baseline.json') ~= nil
  return wrote
end, 200)
check(wrote, 'the baseline was written')

if wrote then
  local after = false
  depwatch.scan(project .. '/package.json', {
    on_done = function()
      after = true
    end,
  })
  vim.wait(120000, function()
    return after
  end, 200)
  local rescan = depwatch.result_for(project .. '/package.json')
  check(rescan ~= nil and #rescan.report.deps == 0, 'the baseline quietened every finding')
end

print('')
if #failures > 0 then
  print(('%d check(s) failed:'):format(#failures))
  for _, what in ipairs(failures) do
    print('  - ' .. what)
  end
  vim.cmd('cq')
else
  print('all checks passed')
  vim.cmd('qa!')
end
