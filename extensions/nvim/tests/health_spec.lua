-- :checkhealth depwatch, without a checkhealth window.
--
-- vim.health writes into the buffer :checkhealth opened, so what the check says
-- is only readable by recording the calls. Every assertion here is on that
-- report -- the lines a user reads -- and none on state the module wrote.
--
-- The CLI is a shell one-liner rather than a real depwatch: `cmd` is a list so
-- an interpreter can go in front of it, which makes `{ 'sh', '-c', ... }` a
-- legitimate configuration and every branch of the version probe reachable.

local function record()
  local report = {}
  local function put(level)
    return function(message, advice)
      report[#report + 1] = { level = level, message = tostring(message), advice = advice }
    end
  end
  return report, {
    start = put('start'),
    ok = put('ok'),
    info = put('info'),
    warn = put('warn'),
    error = put('error'),
  }
end

--- Run :checkhealth's callback with vim.health captured.
local function check()
  local report, stub = record()
  local saved = vim.health
  vim.health = stub
  local ok, err = pcall(require('depwatch.health').check)
  vim.health = saved
  assert(ok, tostring(err))
  return report
end

--- The first line at `level` whose text matches `pattern`, or nil.
local function said(report, level, pattern)
  for _, entry in ipairs(report) do
    if entry.level == level and entry.message:find(pattern) then
      return entry
    end
  end
  return nil
end

local project

local function setup(opts)
  package.loaded['depwatch'] = nil
  local dw = require('depwatch')
  dw.setup(vim.tbl_deep_extend('force', {
    scan = { on_startup = false, on_save = false, refresh_minutes = 0 },
    max_manifests = 5,
  }, opts))
  return dw
end

--- An empty project, current directory, and no buffer for vim.fs.root to follow.
local function fresh()
  project = vim.fn.tempname()
  vim.fn.mkdir(project, 'p')
  vim.fn.chdir(project)
  vim.cmd('enew!')
end

describe('the report header', function()
  before_each(fresh)

  it('opens a depwatch section and names the Neovim it found', function()
    package.loaded['depwatch'] = nil
    local report = check()
    assert.equals('start', report[1].level)
    assert.equals('depwatch', report[1].message)
    assert.is_truthy(said(report, 'ok', 'Neovim'))
  end)

  it('says so when setup() has not run, rather than indexing a nil config', function()
    package.loaded['depwatch'] = nil
    assert.is_truthy(said(check(), 'info', 'setup%(%) has not run yet'))
  end)

  it('does not say that once setup() has run', function()
    setup({ cmd = { 'sh', '-c', 'echo depwatch' } })
    assert.is_nil(said(check(), 'info', 'setup%(%) has not run yet'))
  end)
end)

describe('the CLI probe', function()
  before_each(fresh)

  it('names the missing executable and how to point at a checkout', function()
    setup({ cmd = { 'depwatch-not-on-this-path' } })
    local entry = said(check(), 'error', 'is not executable')
    assert.is_truthy(entry)
    assert.is_truthy(entry.message:find('depwatch%-not%-on%-this%-path'))
    assert.is_truthy(table.concat(entry.advice, '\n'):find("require%('depwatch'%)%.setup"))
  end)

  it('reports a binary that is there but will not run', function()
    setup({ cmd = { 'sh', '-c', 'echo boom >&2; exit 3' } })
    local report = check()
    assert.is_truthy(said(report, 'error', 'did not run'))
    assert.is_truthy(said(report, 'error', 'boom'))
  end)

  it('warns when something ran but is not depwatch', function()
    setup({ cmd = { 'sh', '-c', 'echo usage: ripgrep' } })
    local report = check()
    assert.is_truthy(said(report, 'warn', 'does not look like depwatch'))
    assert.is_nil(said(report, 'ok', 'runs'))
  end)

  it('accepts help printed on stderr, which is where many CLIs put it', function()
    setup({ cmd = { 'sh', '-c', 'echo "depwatch check --accepted" >&2' } })
    local report = check()
    assert.is_truthy(said(report, 'ok', 'runs'))
    assert.is_truthy(said(report, 'ok', 'supports %-%-accepted'))
  end)

  it('treats a non-zero exit with nothing on stdout as a failure to run', function()
    setup({ cmd = { 'sh', '-c', 'echo "depwatch check --accepted" >&2; exit 1' } })
    assert.is_truthy(said(check(), 'error', 'did not run'))
  end)

  it('warns about a build with no --accepted, because baselines will fail', function()
    setup({ cmd = { 'sh', '-c', 'echo "depwatch check --json"' } })
    local report = check()
    assert.is_truthy(said(report, 'ok', 'runs'))
    local entry = said(report, 'warn', 'no %-%-accepted support')
    assert.is_truthy(entry)
    assert.is_truthy(table.concat(entry.advice, '\n'):find('Update depwatch'))
  end)

  it('confirms --accepted when the help mentions it', function()
    setup({ cmd = { 'sh', '-c', 'echo "depwatch check --accepted FILE"' } })
    assert.is_truthy(said(check(), 'ok', 'supports %-%-accepted'))
  end)
end)

describe('the project', function()
  before_each(fresh)

  it('warns when the root holds no manifest, and points at the two settings', function()
    vim.fn.writefile({ '' }, project .. '/.git')
    setup({ cmd = { 'sh', '-c', 'echo depwatch' } })
    local entry = said(check(), 'warn', 'no dependency manifests found')
    assert.is_truthy(entry)
    assert.is_truthy(table.concat(entry.advice, '\n'):find('`manifests` and `exclude`'))
  end)

  it('lists the manifests it found, relative to the root', function()
    vim.fn.writefile({ '{}' }, project .. '/package.json')
    setup({ cmd = { 'sh', '-c', 'echo depwatch' } })
    local entry = said(check(), 'ok', 'manifest%(s%)')
    assert.is_truthy(entry)
    assert.is_truthy(entry.message:find('1 manifest%(s%): package.json', 1, false))
  end)

  it('does not look for manifests before setup() has run', function()
    package.loaded['depwatch'] = nil
    vim.fn.writefile({ '{}' }, project .. '/package.json')
    local report = check()
    assert.is_nil(said(report, 'ok', 'manifest%(s%)'))
    assert.is_nil(said(report, 'warn', 'no dependency manifests found'))
  end)
end)

describe('the baseline', function()
  before_each(fresh)

  it('says where it is not, which is the normal case', function()
    vim.fn.writefile({ '{}' }, project .. '/package.json')
    setup({ cmd = { 'sh', '-c', 'echo depwatch' } })
    assert.is_truthy(said(check(), 'info', 'baseline: none at %.depwatch%-baseline%.json'))
  end)

  it('says findings are hidden when one is there', function()
    vim.fn.writefile({ '{}' }, project .. '/package.json')
    vim.fn.writefile({ '{}' }, project .. '/accepted.json')
    setup({ cmd = { 'sh', '-c', 'echo depwatch' }, baseline = { path = 'accepted.json' } })
    assert.is_truthy(said(check(), 'ok', 'accepted%.json %(findings it accepts are hidden%)'))
  end)
end)

describe('deep scans', function()
  before_each(fresh)

  it('warns when deep is on without a token, and not when it is off', function()
    local saved = vim.env.GITHUB_TOKEN
    vim.env.GITHUB_TOKEN = nil

    setup({ cmd = { 'sh', '-c', 'echo depwatch' }, deep = true })
    assert.is_truthy(said(check(), 'warn', 'GITHUB_TOKEN is unset'))

    setup({ cmd = { 'sh', '-c', 'echo depwatch' }, deep = false })
    assert.is_nil(said(check(), 'warn', 'GITHUB_TOKEN is unset'))

    vim.env.GITHUB_TOKEN = saved
  end)

  it('stays quiet when a token is set', function()
    local saved = vim.env.GITHUB_TOKEN
    vim.env.GITHUB_TOKEN = 'ghp_not_a_real_token'
    setup({ cmd = { 'sh', '-c', 'echo depwatch' }, deep = true })
    assert.is_nil(said(check(), 'warn', 'GITHUB_TOKEN is unset'))
    vim.env.GITHUB_TOKEN = saved
  end)
end)
