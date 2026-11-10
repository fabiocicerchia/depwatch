@domain:policy-gates @area:gates @from:extensions/nvim
Feature: Checking CI gates from the editor
  Lets a developer find out before pushing whether the drift budget CI enforces would fail, using the same arithmetic as `depwatch check --ci`.

  Background:
    Given the plugin has scanned package.json

  @id:policy-gates.gates.001 @rule:editor.gates.unconfigured-warns @verified @source:extensions/nvim/lua/depwatch/commands.lua#gates @test:extensions/nvim/tests/init_spec.lua#says nothing is configured rather than passing by default
  Scenario: With no gate configured, the gate check says so instead of passing
    Given neither gates.max_libyears nor gates.max_replace is set
    When the developer runs :DepwatchGates
    Then the developer sees a warning starting "depwatch: no gates configured. Set gates.max_libyears or gates.max_replace"
    And no pass message is shown

  @id:policy-gates.gates.002 @rule:editor.gates.failures-name-manifest @verified @source:extensions/nvim/lua/depwatch/commands.lua#gates @test:extensions/nvim/tests/init_spec.lua#names every failing gate, with the manifest it failed on
  Scenario: Each failing gate is named together with the manifest it failed on
    Given gates.max_libyears is 1 and gates.max_replace is 0
    And package.json totals 2.00 libyears with 1 Replace dependency
    When the developer runs :DepwatchGates
    Then the developer sees a warning "depwatch: 2 gate(s) failing —"
    And it lists "package.json: total drift 2.00 libyears exceeds max_libyears 1"
    And it lists "package.json: 1 deps in the replace quadrant exceeds max_replace 0"
