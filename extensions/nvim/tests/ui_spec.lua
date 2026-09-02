-- What the user actually sees: the diagnostics and virtual text drawn on a
-- manifest, and the lines the report float is filled with.
--
-- Nothing here asserts on a variable the module set. `render` is read back
-- through `vim.diagnostic.get` and `nvim_buf_get_extmarks` -- the same two APIs
-- the editor itself reads the marks from -- and `report_lines` returns the
-- lines, so they are simply compared.

local config = require('depwatch.config')
local ui = require('depwatch.ui')

local VIRT_NS = vim.api.nvim_create_namespace('depwatch.virt')

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

--- A real buffer holding a real manifest, which is what render needs to draw on.
local function open_manifest()
  local dir = vim.fn.tempname()
  vim.fn.mkdir(dir, 'p')
  local path = dir .. '/package.json'
  vim.fn.writefile(MANIFEST, path)
  vim.cmd.edit(vim.fn.fnameescape(path))
  return vim.api.nvim_buf_get_name(0), vim.api.nvim_get_current_buf()
end

local function diagnostics(buf)
  return vim.diagnostic.get(buf, { namespace = ui.namespace })
end

local function virtual_texts(buf)
  local out = {}
  for _, mark in ipairs(vim.api.nvim_buf_get_extmarks(buf, VIRT_NS, 0, -1, { details = true })) do
    out[#out + 1] = { lnum = mark[2], text = mark[4].virt_text[1][1], hl = mark[4].virt_text[1][2] }
  end
  return out
end

local function by_name(diags)
  local out = {}
  for _, d in ipairs(diags) do
    out[d.message:match('^([^:]+)')] = d
  end
  return out
end

describe('render', function()
  local cfg

  before_each(function()
    cfg = config.resolve({})
    vim.cmd('silent! %bwipeout!')
  end)

  it('underlines each dependency on the line it is written on', function()
    local path, buf = open_manifest()
    ui.render(path, report({ dep(), dep({ name = 'request', current = '2.88.0', quadrant = 'upgrade' }) }), cfg)

    local found = by_name(diagnostics(buf))
    -- The span is the name itself, not the quotes around it: column 5 of
    -- `    "left-pad": "1.1.0",` is the l.
    assert.equals(3, found['left-pad'].lnum)
    assert.equals(5, found['left-pad'].col)
    assert.equals(5 + #'left-pad', found['left-pad'].end_col)
    assert.equals(4, found['request'].lnum)
  end)

  it('carries the quadrant as the diagnostic code and the configured severity', function()
    local path, buf = open_manifest()
    ui.render(path, report({ dep(), dep({ name = 'request', quadrant = 'upgrade' }) }), cfg)

    local found = by_name(diagnostics(buf))
    assert.equals('replace', found['left-pad'].code)
    assert.equals(vim.diagnostic.severity.WARN, found['left-pad'].severity)
    assert.equals('upgrade', found['request'].code)
    assert.equals(vim.diagnostic.severity.INFO, found['request'].severity)
    assert.equals('depwatch', found['left-pad'].source)
  end)

  it('publishes nothing for a quadrant whose severity is false', function()
    local path, buf = open_manifest()
    -- healthy is `false` by default, which means "do not publish", not "info".
    ui.render(path, report({ dep({ name = 'lodash', quadrant = 'healthy' }) }), cfg)
    assert.equals(0, #diagnostics(buf))
  end)

  it('leaves a dependency that is written nowhere in the file unmarked', function()
    local path, buf = open_manifest()
    -- A transitive dep out of the lock file: still in the report, no line to
    -- point at, so it gets no mark rather than a wrong one.
    ui.render(path, report({ dep(), dep({ name = 'not-in-this-file' }) }), cfg)
    assert.equals(1, #diagnostics(buf))
    assert.equals('left-pad', diagnostics(buf)[1].message:match('^([^:]+)'))
  end)

  it('says no registry data, not a score, for a degraded dependency', function()
    local path, buf = open_manifest()
    cfg.diagnostics.severity.degraded = vim.diagnostic.severity.HINT
    ui.render(path, report({ dep({ degraded = 'timeout' }) }), cfg)

    local diag = diagnostics(buf)[1]
    assert.equals('degraded', diag.code)
    assert.is_truthy(diag.message:find('no registry data %(timeout%)'))
  end)

  it('draws drift at the end of the line, for the configured lenses only', function()
    local path, buf = open_manifest()
    ui.render(path, report({
      dep(),
      dep({ name = 'lodash', quadrant = 'healthy', libyearsBehind = 0.0 }),
    }), cfg)

    local marks = virtual_texts(buf)
    assert.equals(1, #marks)
    assert.equals(3, marks[1].lnum)
    assert.equals('  2.00 ly · Replace', marks[1].text)
    assert.equals('DiagnosticError', marks[1].hl)
  end)

  it('does not annotate a dependency it has no numbers for', function()
    local path, buf = open_manifest()
    ui.render(path, report({ dep({ degraded = 'timeout' }) }), cfg)
    assert.equals(0, #virtual_texts(buf))
  end)

  it('clears everything when both surfaces are turned off', function()
    local path, buf = open_manifest()
    ui.render(path, report({ dep() }), cfg)
    assert.equals(1, #diagnostics(buf))

    cfg.diagnostics.enabled = false
    cfg.virtual_text.enabled = false
    ui.render(path, report({ dep() }), cfg)
    assert.equals(0, #diagnostics(buf))
    assert.equals(0, #virtual_texts(buf))
  end)

  it('is a no-op for a manifest nothing has open', function()
    vim.cmd('enew!')
    assert.has_no.errors(function()
      ui.render('/nowhere/package.json', report({ dep() }), cfg)
    end)
  end)

  it('clear takes the marks off again', function()
    local path, buf = open_manifest()
    ui.render(path, report({ dep() }), cfg)
    ui.clear(path)
    assert.equals(0, #diagnostics(buf))
    assert.equals(0, #virtual_texts(buf))
  end)
end)

describe('text_of', function()
  it('prefers the unsaved buffer, because that is what the line numbers mean', function()
    local path, buf = open_manifest()
    vim.api.nvim_buf_set_lines(buf, 0, -1, false, { '{ "edited": true }' })
    assert.equals('{ "edited": true }', ui.text_of(path))
    vim.cmd('silent! %bwipeout!')
  end)

  it('falls back to the disk, and to nothing at all', function()
    local path = open_manifest()
    vim.cmd('silent! %bwipeout!')
    assert.equals(table.concat(MANIFEST, '\n'), ui.text_of(path))
    assert.is_nil(ui.text_of('/nowhere/package.json'))
  end)
end)

describe('report_lines', function()
  local function scan(label, deps, over)
    return { path = '/repo/' .. label, label = label, report = report(deps, over) }
  end

  it('heads each manifest with its ecosystem and a rule of the same width', function()
    local lines = ui.report_lines({ scan('package.json', { dep() }) })
    assert.equals('package.json  (npm)', lines[1])
    assert.equals(vim.fn.strdisplaywidth(lines[1]), vim.fn.strdisplaywidth(lines[2]))
    assert.equals('─', lines[2]:sub(1, #'─'))
  end)

  it('rules a title in columns, not bytes', function()
    -- The severity titles carry em dashes: three bytes, one column each, so a
    -- rule counted in bytes would run three times too long.
    local lines = ui.report_lines({ scan('package.json', { dep() }) }, 'severity')
    assert.is_true(#lines[1] > vim.fn.strdisplaywidth(lines[1]))
    assert.equals(vim.fn.strdisplaywidth(lines[1]), vim.fn.strdisplaywidth(lines[2]))
  end)

  it('lays a row out as name, version, drift, lens and the upgrade', function()
    local row = ui.report_lines({ scan('package.json', { dep() }) })[3]
    assert.is_truthy(row:find('left%-pad'))
    assert.is_truthy(row:find('1%.1%.0'))
    assert.is_truthy(row:find('2%.00'))
    assert.is_truthy(row:find('Replace'))
    assert.is_truthy(row:find('→ 1%.3%.0'))
  end)

  it('trims the padding off a row whose last column is empty', function()
    -- Nothing to upgrade to, so the bump column is blank; a float has no
    -- columns after it, and a run of trailing spaces reads as a bug.
    local row = ui.report_lines({ scan('package.json', { dep({ latest = '1.1.0' }) }) })[3]
    assert.is_nil(row:find('%s$'))
    assert.is_truthy(row:find('Replace$'))
  end)

  it('writes an em dash rather than a score for a degraded dependency', function()
    local row = ui.report_lines({ scan('package.json', { dep({ degraded = 'timeout' }) }) })[3]
    assert.is_truthy(row:find('—'))
    assert.is_nil(row:find('2%.00'))
  end)

  it('keeps a clean manifest, and says it is clean', function()
    local lines = ui.report_lines({ scan('package.json', {}, { totalLibyears = 0 }) })
    assert.equals('  nothing to address', lines[3])
  end)

  it('ends on the bottom line across every manifest', function()
    local lines = ui.report_lines({
      scan('package.json', { dep() }),
      scan('web/package.json', { dep({ name = 'request' }) }),
    })
    assert.equals('4.00 libyears · 2 of 2 deps to address', lines[#lines])
  end)

  it('drops the lens column when the groups already are the lenses', function()
    local lines = ui.report_lines({ scan('package.json', { dep() }) }, 'severity')
    assert.is_truthy(lines[1]:find('^Replace — '))
    -- The lens is the heading, so it is not repeated on the row; the file is
    -- not the heading any more, so it is.
    assert.is_nil(lines[3]:find('Replace'))
    assert.is_truthy(lines[3]:find('package%.json'))
  end)

  it('names the ecosystem as the heading when asked for that axis', function()
    local lines = ui.report_lines({ scan('package.json', { dep() }) }, 'ecosystem')
    assert.equals('npm', lines[1])
    assert.is_truthy(lines[3]:find('Replace'))
    assert.is_truthy(lines[3]:find('package%.json'))
  end)
end)

describe('float', function()
  it('returns a read-only scratch buffer holding the lines it was given', function()
    local buf, win = ui.float({ 'one', 'two' }, { title = ' t ', filetype = 'depwatch-report' })
    assert.same({ 'one', 'two' }, vim.api.nvim_buf_get_lines(buf, 0, -1, false))
    assert.is_false(vim.bo[buf].modifiable)
    assert.equals('depwatch-report', vim.bo[buf].filetype)
    assert.is_true(vim.api.nvim_win_is_valid(win))
    vim.api.nvim_win_close(win, true)
  end)

  it('is wide enough for its widest line and never wider than the editor', function()
    local wide = string.rep('x', 500)
    local _, win = ui.float({ 'short', wide })
    assert.equals(math.floor(vim.o.columns * 0.9), vim.api.nvim_win_get_width(win))
    vim.api.nvim_win_close(win, true)

    local _, narrow = ui.float({ 'x' })
    assert.equals(40, vim.api.nvim_win_get_width(narrow))
    vim.api.nvim_win_close(narrow, true)
  end)

  it('closes on q, so it never needs a window command to get rid of', function()
    local buf, win = ui.float({ 'one' })
    vim.api.nvim_set_current_win(win)
    vim.api.nvim_feedkeys('q', 'x', false)
    assert.is_false(vim.api.nvim_win_is_valid(win))
    assert.is_false(vim.api.nvim_buf_is_valid(buf))
  end)
end)
