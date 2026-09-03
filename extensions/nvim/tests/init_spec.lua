-- setup(), the scan policy and the commands, driven end to end against a fake
-- CLI.
--
-- `cmd` is a list precisely so an interpreter can go in front of it, which makes
-- `{ 'sh', '-c', 'cat report.json' }` a legitimate configuration: the real
-- vim.system call runs, the real callback decodes, and the assertions are on
-- what comes back out -- results(), totals(), statusline(), the quickfix list
-- and the lines handed to the float -- never on a module-local table.

local dw

local project, manifest

local MANIFEST = {
  '{',
  '  "name": "fixture",',
  '  "dependencies": {',
  '    "left-pad": "1.1.0",',
  '    "request": "2.88.0",',
  '    "lodash": "4.17.21"',
  '  }',
  '}',
}

local function dep(over)
  return vim.tbl_extend('force', {
    name = 'left-pad',
    current = '1.1.0',
    latest = '1.3.0',
    resolved = true,
    libyearsBehind = 2.0,
    currentReleased = '2016-03-01T00:00:00.000Z',
    latestReleased = '2018-04-01T00:00:00.000Z',
    pulseYears = 6.5,
    viability = 0.2,
    quadrant = 'replace',
    signals = {},
  }, over or {})
end

--- Write `value` as the JSON the fake CLI will print, and return the argv that
--- prints it.
local function prints(value)
  local path = vim.fn.tempname()
  vim.fn.writefile({ vim.json.encode(value) }, path)
  return { 'sh', '-c', 'cat ' .. path }
end

local function report(deps, over)
  return vim.tbl_extend('force', {
    file = 'package.json',
    ecosystem = 'npm',
    generatedAt = '2026-01-01T00:00:00.000Z',
    totalLibyears = 2.0,
    deps = deps,
    worst = deps,
  }, over or {})
end

--- A fresh module and a fresh project. The module keeps its results in an
--- upvalue, so a reload is the only way to start from nothing.
local function setup(opts)
  package.loaded['depwatch'] = nil
  dw = require('depwatch')
  dw.setup(vim.tbl_deep_extend('force', {
    scan = { on_startup = false, on_save = false, refresh_minutes = 0 },
  }, opts or {}))
  return dw
end

local function fresh()
  project = vim.fn.tempname()
  vim.fn.mkdir(project, 'p')
  manifest = project .. '/package.json'
  vim.fn.writefile(MANIFEST, manifest)
  vim.fn.chdir(project)
  vim.cmd('silent! %bwipeout!')
end

--- Run one scan and wait for its callback; returns what on_done was told.
local function scan(path, opts)
  local outcome
  dw.scan(path, vim.tbl_extend('force', opts or {}, {
    on_done = function(ok)
      outcome = ok
    end,
  }))
  assert(vim.wait(5000, function()
    return outcome ~= nil
  end, 10), 'the scan never called back')
  return outcome
end

--- Capture the lines a command hands to the float instead of opening one.
--- Several commands open theirs from a scan callback, so this waits for one.
local function captured_float(fn)
  local ui = require('depwatch.ui')
  local real, lines, opts = ui.float, nil, nil
  ui.float = function(l, o)
    lines, opts = l, o
    return 0, 0
  end
  local ok, err = pcall(fn)
  if ok then
    vim.wait(5000, function()
      return lines ~= nil
    end, 10)
  end
  ui.float = real
  assert(ok, tostring(err))
  return lines, opts
end

--- Capture vim.notify, which is the only thing several commands produce.
--- `wanted` waits for that many notifications, for the asynchronous ones.
local function captured_notify(fn, wanted)
  local real, said = vim.notify, {}
  vim.notify = function(message, level)
    said[#said + 1] = { message = message, level = level }
  end
  local ok, err = pcall(fn)
  if ok and wanted then
    vim.wait(5000, function()
      return #said >= wanted
    end, 10)
  end
  vim.notify = real
  assert(ok, tostring(err))
  return said
end

local function notified(said, pattern)
  for _, entry in ipairs(said) do
    if tostring(entry.message):find(pattern) then
      return entry
    end
  end
  return nil
end

describe('finding manifests', function()
  before_each(fresh)

  it('recognises the files it would scan, by basename', function()
    setup()
    assert.is_true(dw.is_manifest(manifest))
    assert.is_true(dw.is_manifest('/anywhere/Cargo.toml'))
    assert.is_false(dw.is_manifest('/anywhere/package-lock.json'))
    assert.is_false(dw.is_manifest('/anywhere/README.md'))
  end)

  it('lists them shallowest first, because the root one is the one meant', function()
    vim.fn.mkdir(project .. '/web/deep', 'p')
    vim.fn.writefile({ '{}' }, project .. '/web/package.json')
    vim.fn.writefile({ '{}' }, project .. '/web/deep/package.json')
    setup()

    local found = dw.manifests()
    assert.equals(manifest, found[1])
    assert.equals(project .. '/web/package.json', found[2])
    assert.equals(project .. '/web/deep/package.json', found[3])
  end)

  it('never descends into an excluded directory', function()
    vim.fn.mkdir(project .. '/node_modules/left-pad', 'p')
    vim.fn.writefile({ '{}' }, project .. '/node_modules/left-pad/package.json')
    setup()

    assert.same({ manifest }, dw.manifests())
  end)

  it('stops at max_manifests', function()
    for i = 1, 4 do
      vim.fn.mkdir(project .. '/p' .. i, 'p')
      vim.fn.writefile({ '{}' }, project .. '/p' .. i .. '/package.json')
    end
    setup({ max_manifests = 2 })
    assert.equals(2, #dw.manifests())
  end)
end)

describe('scanning', function()
  before_each(fresh)

  it('keeps the report, and answers with it', function()
    setup({ cmd = prints(report({ dep(), dep({ name = 'request', quadrant = 'upgrade' }) })) })
    assert.is_true(scan(manifest))

    local scans = dw.results()
    assert.equals(1, #scans)
    assert.equals('package.json', scans[1].label)
    assert.equals(2, #scans[1].report.deps)

    local totals = dw.totals()
    assert.equals(2.0, totals.libyears)
    assert.equals(2, totals.deps)
    assert.equals(2, totals.to_address)
    assert.equals('2.00 ly · 2', dw.statusline())
  end)

  it('drops the ly count from the statusline when there is nothing to address', function()
    setup({ cmd = prints(report({ dep({ quadrant = 'healthy' }) }, { totalLibyears = 0 })) })
    assert.is_true(scan(manifest))
    assert.equals('0.00 ly', dw.statusline())
  end)

  it('says nothing at all before the first scan', function()
    setup({ cmd = prints(report({ dep() })) })
    assert.equals('', dw.statusline())
  end)

  it('treats a manifest with no dependencies as normal, not as a failure', function()
    setup({ cmd = { 'sh', '-c', 'echo "depwatch: no dependencies found" >&2; exit 1' } })
    local said = captured_notify(function()
      assert.is_false(scan(manifest, { notify = true }))
    end)
    assert.same({}, dw.results())
    assert.is_nil(notified(said, 'no dependencies found'))
  end)

  it('reports a manifest it genuinely could not read', function()
    setup({ cmd = { 'sh', '-c', 'echo "Cargo.toml is not valid TOML" >&2; exit 1' } })
    local said = captured_notify(function()
      assert.is_false(scan(manifest, { notify = true }))
    end)
    assert.same({}, dw.results())
    assert.is_truthy(notified(said, 'not valid TOML'))
  end)

  it('refuses output that is not a depwatch report', function()
    setup({ cmd = prints({ hello = 'world' }) })
    local said = captured_notify(function()
      assert.is_false(scan(manifest, { notify = true }))
    end)
    assert.same({}, dw.results())
    assert.is_truthy(notified(said, 'is `cmd` pointing at depwatch'))
  end)

  it('refuses output that is not JSON at all', function()
    setup({ cmd = { 'sh', '-c', 'echo not json' } })
    assert.is_false(scan(manifest))
    assert.same({}, dw.results())

    -- Read back through :DepwatchLog, which is where a user would find it.
    local lines = captured_float(function()
      dw.show_log()
    end)
    assert.is_truthy(table.concat(lines, '\n'):find('could not read depwatch output as JSON'))
  end)

  it('does nothing at all when the plugin is disabled', function()
    setup({ enabled = false, cmd = prints(report({ dep() })) })
    dw.scan(manifest, {})
    dw.scan_all({})
    assert.same({}, dw.results())
  end)

  it('warns once when the project has no manifest to scan', function()
    vim.fn.delete(manifest)
    setup({ cmd = prints(report({ dep() })) })
    local said = captured_notify(function()
      dw.scan_all({ notify = true })
    end)
    assert.is_truthy(notified(said, 'no dependency manifests found'))
  end)

  it('logs the command it ran and what it found', function()
    setup({ cmd = prints(report({ dep() })) })
    assert.is_true(scan(manifest))
    local log = table.concat(captured_float(function()
      dw.show_log()
    end), '\n')
    assert.is_truthy(log:find('run: sh %-c'))
    assert.is_truthy(log:find('package%.json: 2%.00 libyears, 1 deps'))
  end)

  it('says there is nothing to cancel when nothing is running', function()
    setup({ cmd = prints(report({ dep() })) })
    local said = captured_notify(function()
      dw.cancel()
    end)
    assert.is_truthy(notified(said, 'no scan is running'))
  end)
end)

describe('the scan a file belongs to', function()
  before_each(fresh)

  it('is the manifest itself, or the nearest one above it', function()
    vim.fn.mkdir(project .. '/web/src', 'p')
    vim.fn.writefile(MANIFEST, project .. '/web/package.json')
    setup({ cmd = prints(report({ dep() })) })
    assert.is_true(scan(manifest))
    assert.is_true(scan(project .. '/web/package.json'))

    assert.equals('web/package.json', dw.result_for(project .. '/web/src/app.js').label)
    assert.equals('package.json', dw.result_for(project .. '/other/app.js').label)
    assert.equals('web/package.json', dw.result_for(project .. '/web/package.json').label)
  end)

  it('is nothing at all for a file under no scanned manifest', function()
    setup({ cmd = prints(report({ dep() })) })
    assert.is_nil(dw.result_for('/elsewhere/app.js'))
  end)
end)

describe('the quickfix list', function()
  before_each(fresh)

  local function listed(opts)
    vim.fn.setqflist({}, 'r')
    dw.list(opts or {})
    return vim.fn.getqflist({ items = 1, title = 1 })
  end

  it('points at the line each dependency is written on', function()
    setup({ cmd = prints(report({ dep(), dep({ name = 'request', quadrant = 'upgrade' }) })) })
    assert.is_true(scan(manifest))

    local qf = listed()
    assert.equals('depwatch', qf.title)
    assert.equals(2, #qf.items)
    -- Quickfix is 1-based where the index is 0-based, and worst comes first.
    assert.equals(4, qf.items[1].lnum)
    assert.equals(6, qf.items[1].col)
    assert.equals('E', qf.items[1].type)
    assert.is_truthy(qf.items[1].text:find('left%-pad: Replace'))
    assert.equals('W', qf.items[2].type)
  end)

  it('keeps a dependency written down nowhere, pointing at the file', function()
    setup({ cmd = prints(report({ dep({ name = 'transitive-only' }) })) })
    assert.is_true(scan(manifest))

    local qf = listed()
    assert.equals(1, #qf.items)
    assert.equals(1, qf.items[1].lnum)
    assert.equals(1, qf.items[1].col)
  end)

  it('leaves healthy dependencies out unless asked for everything', function()
    setup({ cmd = prints(report({ dep(), dep({ name = 'lodash', quadrant = 'healthy' }) })) })
    assert.is_true(scan(manifest))

    assert.equals(1, #listed().items)
    local all = listed({ all = true })
    assert.equals(2, #all.items)
    assert.equals('depwatch: every dependency', all.title)
    assert.equals('I', all.items[2].type)
  end)

  it('marks a degraded dependency as a note, not an error', function()
    setup({ cmd = prints(report({ dep({ degraded = 'timeout' }) })) })
    assert.is_true(scan(manifest))
    assert.equals('N', listed().items[1].type)
  end)

  it('says nothing to address rather than opening an empty list', function()
    setup({ cmd = prints(report({ dep({ quadrant = 'healthy' }) })) })
    assert.is_true(scan(manifest))
    local said = captured_notify(function()
      dw.list({})
    end)
    assert.is_truthy(notified(said, 'nothing to address'))
  end)
end)

describe('the report command', function()
  before_each(fresh)

  it('renders the scans it has, grouped the way config asked', function()
    setup({ cmd = prints(report({ dep() })), report = { group_by = 'severity' } })
    assert.is_true(scan(manifest))

    local lines, opts = captured_float(function()
      dw.report()
    end)
    assert.is_truthy(lines[1]:find('^Replace — '))
    assert.equals(' depwatch report — by severity ', opts.title)
    assert.equals('depwatch-report', opts.filetype)
  end)

  it('changes the grouping for the session, and refuses an axis it has no bucket for', function()
    setup({ cmd = prints(report({ dep() })) })
    assert.is_true(scan(manifest))

    local said = captured_notify(function()
      dw.group_by('nonsense')
    end)
    assert.is_truthy(notified(said, 'cannot group by "nonsense"'))

    local lines = captured_float(function()
      dw.group_by('ecosystem')
    end)
    assert.equals('npm', lines[1])
  end)

  it('shows the log, and says when there is nothing in it', function()
    setup({ cmd = prints(report({ dep() })) })
    local lines = captured_float(function()
      dw.show_log()
    end)
    assert.same({ 'nothing logged yet' }, lines)
  end)
end)

describe('the gates', function()
  before_each(fresh)

  it('says nothing is configured rather than passing by default', function()
    setup({ cmd = prints(report({ dep() })) })
    local said = captured_notify(function()
      dw.gates()
    end)
    assert.is_truthy(notified(said, 'no gates configured'))
  end)

  it('names every failing gate, with the manifest it failed on', function()
    setup({ cmd = prints(report({ dep() })), gates = { max_libyears = 1, max_replace = 0 } })
    assert.is_true(scan(manifest))

    local said = captured_notify(function()
      dw.gates()
    end)
    local entry = notified(said, 'gate%(s%) failing')
    assert.is_truthy(entry)
    assert.is_truthy(entry.message:find('package%.json: total drift 2%.00 libyears'))
    assert.is_truthy(entry.message:find('package%.json: 1 deps in the replace quadrant'))
  end)

  it('passes when the budget holds', function()
    setup({ cmd = prints(report({ dep() })), gates = { max_libyears = 10 } })
    assert.is_true(scan(manifest))
    local said = captured_notify(function()
      dw.gates()
    end)
    assert.is_truthy(notified(said, 'gates pass'))
  end)
end)

describe('the trend command', function()
  before_each(fresh)

  local POINTS = {
    { date = '2025-01-02T00:00:00.000Z', commit = 'aaaaaaa', totalLibyears = 1.0, deps = 3, replace = 0 },
    { date = '2026-01-02T00:00:00.000Z', commit = 'bbbbbbb', totalLibyears = 4.5, deps = 4, replace = 2 },
  }

  --- The trend command acts on the current buffer when that is a manifest.
  local function on_manifest()
    vim.cmd.edit(vim.fn.fnameescape(manifest))
  end

  it('renders one row per commit and the drift between the ends', function()
    setup({ cmd = prints(POINTS) })
    on_manifest()

    local lines, opts = captured_float(function()
      dw.trend()
    end)
    assert.is_truthy(lines)
    assert.equals(' depwatch trend ', opts.title)
    assert.equals('# package.json', lines[1])
    assert.is_truthy(lines[3]:find('^2025%-01%-02  aaaaaaa'))
    assert.is_truthy(lines[3]:find('1%.00 libyears'))
    assert.is_truthy(lines[3]:find('3 deps'))
    assert.is_truthy(lines[3]:find('0 replace'))
    assert.equals('+3.50 libyears over 2 sampled commits', lines[#lines])
  end)

  it('signs a fall as a fall', function()
    setup({ cmd = prints({ POINTS[2], POINTS[1] }) })
    on_manifest()
    local lines = captured_float(function()
      dw.trend()
    end)
    assert.equals('-3.50 libyears over 2 sampled commits', lines[#lines])
  end)

  it('leaves the delta off when there is only one commit to compare', function()
    setup({ cmd = prints({ POINTS[1] }) })
    on_manifest()
    local lines = captured_float(function()
      dw.trend()
    end)
    assert.is_nil(table.concat(lines, '\n'):find('sampled commits'))
  end)

  it('says so when there is no history to read', function()
    setup({ cmd = prints({}) })
    on_manifest()
    local said = captured_notify(function()
      dw.trend()
    end, 2)
    assert.is_truthy(notified(said, 'no history for that manifest'))
  end)
end)

describe('the baseline', function()
  before_each(fresh)

  it('says there was nothing to clear when there is no file', function()
    setup({ cmd = prints(report({ dep() })) })
    local said = captured_notify(function()
      dw.clear_baseline()
    end)
    assert.is_truthy(notified(said, 'there was no baseline to clear'))
  end)

  it('removes the file and says every finding is shown again', function()
    vim.fn.writefile({ '{}' }, project .. '/.depwatch-baseline.json')
    setup({ cmd = prints(report({ dep() })) })
    local said = captured_notify(function()
      dw.clear_baseline()
    end)
    assert.is_truthy(notified(said, 'baseline cleared'))
    assert.equals(0, vim.fn.filereadable(project .. '/.depwatch-baseline.json'))
  end)

  it('names --accepted on the command line only when the file is there', function()
    local function ran()
      return table.concat(captured_float(function()
        dw.show_log()
      end), '\n')
    end

    setup({ cmd = prints(report({ dep() })) })
    assert.is_true(scan(manifest))
    -- "no baseline yet" is the normal case; an --accepted naming a missing file
    -- is an error to the CLI, so the flag has to be absent, not empty.
    assert.is_nil(ran():find('%-%-accepted'))

    vim.fn.writefile({ '{}' }, project .. '/.depwatch-baseline.json')
    setup({ cmd = prints(report({ dep() })) })
    assert.is_true(scan(manifest))
    assert.is_truthy(ran():find('%-%-accepted ' .. vim.pesc(project) .. '/%.depwatch%-baseline%.json'))
  end)
end)

describe('the hover', function()
  before_each(fresh)

  it('says the file has not been scanned rather than nothing at all', function()
    setup({ cmd = prints(report({ dep() })) })
    vim.cmd.edit(vim.fn.fnameescape(manifest))
    local said = captured_notify(function()
      dw.hover()
    end)
    assert.is_truthy(notified(said, 'this file has not been scanned'))
  end)

  it('explains the dependency under the cursor', function()
    setup({ cmd = prints(report({ dep() })) })
    assert.is_true(scan(manifest))
    vim.cmd.edit(vim.fn.fnameescape(manifest))
    vim.api.nvim_win_set_cursor(0, { 4, 0 })

    local ui = require('depwatch.ui')
    local real, shown = ui.hover, nil
    ui.hover = function(lines)
      shown = lines
    end
    dw.hover()
    ui.hover = real

    assert.is_truthy(shown)
    assert.equals('**left-pad** 1.1.0 → **1.3.0**', shown[1])
  end)

  it('says there is nothing on this line when the cursor is elsewhere', function()
    setup({ cmd = prints(report({ dep() })) })
    assert.is_true(scan(manifest))
    vim.cmd.edit(vim.fn.fnameescape(manifest))
    vim.api.nvim_win_set_cursor(0, { 1, 0 })
    local said = captured_notify(function()
      dw.hover()
    end)
    assert.is_truthy(notified(said, 'no dependency on this line'))
  end)
end)
