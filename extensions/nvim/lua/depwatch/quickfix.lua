-- Findings as a quickfix list.
--
-- The scans come in already made; nothing here scans, configures or keeps
-- state, so the list is a pure function of what the last scan found plus the
-- thresholds the message quotes.

local core = require('depwatch.core')
local notify = require('depwatch.notify')
local ui = require('depwatch.ui')

local M = {}

--- Quickfix's own severity letters, by quadrant. Not the configured diagnostic
--- severities: those decide what is worth underlining in a manifest, which is a
--- different question from how a list of findings sorts and colours.
local QF_TYPE = { replace = 'E', upgrade = 'W', watch = 'I', healthy = 'I', degraded = 'N' }

--- Where this scan's dependencies are written, from the same index the marks
--- and the hover use, so jumping from the list lands where the underline is.
local function spans_of(scan)
  local names = {}
  for _, dep in ipairs(scan.report.deps or {}) do
    names[#names + 1] = dep.name
  end
  local text = ui.text_of(scan.path)
  return text and core.locate(text, scan.path, names) or {}
end

--- One row. Quickfix counts from one where the index counts from zero.
---
--- A transitive dep is written down nowhere in this manifest. It is still a
--- finding, so it points at the file itself rather than being dropped.
local function qf_item(scan, dep, span, thresholds)
  return {
    filename = scan.path,
    lnum = span and span.lnum + 1 or 1,
    col = span and span.col + 1 or 1,
    type = QF_TYPE[core.lens_of(dep)] or 'I',
    text = core.summarise(dep, thresholds),
  }
end

--- Every finding `keep` accepts, worst first, as quickfix rows.
function M.items(scans, thresholds, keep)
  local items = {}
  for _, scan in ipairs(scans) do
    local spans = spans_of(scan)
    for _, dep in ipairs(core.sorted_deps(scan.report)) do
      if keep(dep) then
        items[#items + 1] = qf_item(scan, dep, spans[dep.name], thresholds)
      end
    end
  end
  return items
end

--- Show the list, or say why there is none. An empty quickfix window is worse
--- than a one-line message.
local function open(title, items, empty)
  if #items == 0 then
    return notify(empty)
  end
  vim.fn.setqflist({}, ' ', { title = title, items = items })
  vim.cmd('copen')
end

--- Every finding, in the quickfix list.
---
--- A healthy dependency is not a finding, so the default list is everything off
--- the healthy quadrant -- the same set the summary calls "to address". `all`
--- asks for the whole dependency list, healthy ones included.
function M.list(scans, thresholds, all)
  local keep = all and function()
    return true
  end or function(dep)
    return core.lens_of(dep) ~= 'healthy'
  end
  open(
    all and 'depwatch: every dependency' or 'depwatch',
    M.items(scans, thresholds, keep),
    all and 'nothing scanned yet.' or 'nothing to address.'
  )
end

--- Show only one quadrant. A filter is a way of looking at today's list, so it
--- is not persisted.
---
--- `latest` is a getter rather than a list: the rows are built after the user
--- has picked, and a scan may have landed while the picker was open.
function M.filter(latest, thresholds, totals)
  local items = {}
  for _, lens in ipairs(core.LENSES) do
    local count = lens == 'degraded' and totals.degraded or (totals.counts[lens] or 0)
    items[#items + 1] = { lens = lens, count = count }
  end
  vim.ui.select(items, {
    prompt = 'Show findings for',
    format_item = function(item)
      return string.format('%-8s %3d — %s', core.LABEL[item.lens], item.count, core.BLURB[item.lens])
    end,
  }, function(choice)
    if not choice then
      return
    end
    open(
      'depwatch: ' .. core.LABEL[choice.lens],
      M.items(latest(), thresholds, function(dep)
        return core.lens_of(dep) == choice.lens
      end),
      'nothing in ' .. core.LABEL[choice.lens] .. '.'
    )
  end)
end

return M
