-- Everything the user actually sees: diagnostics on the manifest, drift at the
-- end of the line, and the report in a float.

local core = require('depwatch.core')

local M = {}

local NS = vim.api.nvim_create_namespace('depwatch')
local VIRT_NS = vim.api.nvim_create_namespace('depwatch.virt')

M.namespace = NS

local HL = {
  replace = 'DiagnosticError',
  upgrade = 'DiagnosticWarn',
  watch = 'DiagnosticInfo',
  healthy = 'DiagnosticOk',
  degraded = 'Comment',
}

--- Buffers currently showing a given manifest, if any.
local function buffers_for(path)
  local out = {}
  for _, buf in ipairs(vim.api.nvim_list_bufs()) do
    if vim.api.nvim_buf_is_loaded(buf) and vim.api.nvim_buf_get_name(buf) == path then
      out[#out + 1] = buf
    end
  end
  return out
end

--- The manifest's text, from the buffer when it is open and the disk otherwise.
--- An unsaved buffer is what the user is looking at, and its line numbers are
--- the ones a diagnostic has to match.
local function text_of(path, buf)
  if buf and vim.api.nvim_buf_is_loaded(buf) then
    return table.concat(vim.api.nvim_buf_get_lines(buf, 0, -1, false), '\n')
  end
  local ok, lines = pcall(vim.fn.readfile, path)
  return ok and table.concat(lines, '\n') or nil
end

--- Publish one manifest's findings.
function M.render(path, report, cfg)
  local bufs = buffers_for(path)
  if #bufs == 0 then
    -- Nothing open to draw on. vim.diagnostic wants a buffer, so this manifest
    -- is simply not annotated until it is opened; the report still has it.
    return
  end

  for _, buf in ipairs(bufs) do
    vim.api.nvim_buf_clear_namespace(buf, VIRT_NS, 0, -1)
    if not cfg.diagnostics.enabled and not cfg.virtual_text.enabled then
      vim.diagnostic.reset(NS, buf)
      return
    end

    local text = text_of(path, buf)
    if not text then
      return
    end

    local names = {}
    for _, dep in ipairs(report.deps or {}) do
      names[#names + 1] = dep.name
    end
    local spans = core.locate(text, path, names)
    local line_count = vim.api.nvim_buf_line_count(buf)

    local wanted = {}
    for _, lens in ipairs(cfg.virtual_text.lenses) do
      wanted[lens] = true
    end

    local diagnostics = {}
    for _, dep in ipairs(core.sorted_deps(report)) do
      local span = spans[dep.name]
      -- A dependency the index did not find is one that is not written in this
      -- file -- a transitive dep from the lock file, say. It stays in the
      -- report and simply gets no mark.
      if span and span.lnum < line_count then
        local lens = core.lens_of(dep)
        local severity = cfg.diagnostics.severity[lens]
        if cfg.diagnostics.enabled and severity then
          diagnostics[#diagnostics + 1] = {
            lnum = span.lnum,
            col = span.col,
            end_lnum = span.lnum,
            end_col = span.end_col,
            severity = severity,
            source = 'depwatch',
            code = lens,
            message = core.summarise(dep, cfg.thresholds),
          }
        end
        if cfg.virtual_text.enabled and wanted[lens] and not dep.degraded then
          vim.api.nvim_buf_set_extmark(buf, VIRT_NS, span.lnum, 0, {
            virt_text = {
              {
                string.format('%s%.2f ly · %s', cfg.virtual_text.prefix, dep.libyearsBehind, core.LABEL[lens]),
                HL[lens],
              },
            },
            virt_text_pos = 'eol',
            hl_mode = 'combine',
          })
        end
      end
    end
    vim.diagnostic.set(NS, buf, diagnostics)
  end
end

function M.clear(path)
  for _, buf in ipairs(buffers_for(path)) do
    vim.diagnostic.reset(NS, buf)
    vim.api.nvim_buf_clear_namespace(buf, VIRT_NS, 0, -1)
  end
end

function M.clear_all()
  vim.diagnostic.reset(NS)
  for _, buf in ipairs(vim.api.nvim_list_bufs()) do
    if vim.api.nvim_buf_is_loaded(buf) then
      vim.api.nvim_buf_clear_namespace(buf, VIRT_NS, 0, -1)
    end
  end
end

-- --- floats ------------------------------------------------------------------

--- A scratch buffer in a float. No HTML, no webview: the report is text, and
--- text is what an editor is for.
function M.float(lines, opts)
  opts = opts or {}
  local buf = vim.api.nvim_create_buf(false, true)
  vim.api.nvim_buf_set_lines(buf, 0, -1, false, lines)
  vim.bo[buf].modifiable = false
  vim.bo[buf].filetype = opts.filetype or 'markdown'
  vim.bo[buf].bufhidden = 'wipe'

  local width = 0
  for _, line in ipairs(lines) do
    width = math.max(width, vim.fn.strdisplaywidth(line))
  end
  width = math.min(math.max(width + 2, 40), math.floor(vim.o.columns * 0.9))
  local height = math.min(#lines, math.floor(vim.o.lines * 0.8))

  local win = vim.api.nvim_open_win(buf, true, {
    relative = 'editor',
    row = math.floor((vim.o.lines - height) / 2),
    col = math.floor((vim.o.columns - width) / 2),
    width = width,
    height = height,
    style = 'minimal',
    border = 'rounded',
    title = opts.title or ' depwatch ',
    title_pos = 'center',
  })
  vim.wo[win].wrap = false
  vim.wo[win].cursorline = true
  for _, key in ipairs({ 'q', '<Esc>' }) do
    vim.keymap.set('n', key, function()
      if vim.api.nvim_win_is_valid(win) then
        vim.api.nvim_win_close(win, true)
      end
    end, { buffer = buf, nowait = true, silent = true })
  end
  return buf, win
end

--- The report, as the CLI's own table plus the bottom line.
function M.report_lines(scans)
  local lines = {}
  local reports = {}
  for _, scan in ipairs(scans) do
    reports[#reports + 1] = scan.report
  end

  for _, scan in ipairs(scans) do
    local report = scan.report
    lines[#lines + 1] = string.format('%s  (%s)', scan.label, report.ecosystem)
    lines[#lines + 1] = string.rep('─', #lines[#lines])
    local deps = core.sorted_deps(report)
    if #deps == 0 then
      lines[#lines + 1] = '  nothing to address'
    end
    for _, dep in ipairs(deps) do
      lines[#lines + 1] = string.format(
        '  %-28s %-12s %8s  %-9s %s',
        dep.name,
        dep.current,
        dep.degraded and '—' or string.format('%.2f', dep.libyearsBehind),
        core.LABEL[core.lens_of(dep)],
        dep.latest and dep.latest ~= dep.current and ('→ ' .. dep.latest) or ''
      )
    end
    lines[#lines + 1] = ''
  end

  local totals = core.totals(reports)
  lines[#lines + 1] = core.summary_label(totals)
  return lines
end

--- `vim.lsp.util.open_floating_preview`, so the hover looks like every other
--- hover in the editor rather than like this plugin's own idea of one.
function M.hover(lines)
  return vim.lsp.util.open_floating_preview(lines, 'markdown', {
    border = 'rounded',
    focusable = true,
    max_width = 90,
  })
end

return M
