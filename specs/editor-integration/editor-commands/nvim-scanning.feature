@domain:editor-integration @area:editor-commands @from:extensions/nvim
Feature: Scanning a project from Neovim
  Lets a developer get drift and viability for the project's manifests without leaving Neovim, scanning on demand or when a manifest is saved, never while typing.

  Background:
    Given the depwatch plugin is installed in Neovim
    And the developer has a project open with a package.json at its root

  @id:editor-integration.editor-commands.001 @rule:editor.scan.command-targets-current-manifest-or-project @inferred @source:extensions/nvim/plugin/depwatch.lua#DepwatchScan
  Scenario Outline: A scan command acts on the open manifest, or on the whole project
    Given the developer has <buffer> open
    When the developer runs <command>
    Then <scanned> is scanned
    And the scan <deep_signals> include maintainer, archived and last-commit signals

    Examples:
      | command           | buffer       | scanned                       | deep_signals |
      | :DepwatchScan     | package.json | only package.json             | does not     |
      | :DepwatchScan     | src/app.js   | every manifest in the project | does not     |
      | :DepwatchScanAll  | package.json | every manifest in the project | does not     |
      | :DepwatchDeepScan | src/app.js   | every manifest in the project | does         |

  @id:editor-integration.editor-commands.002 @rule:editor.scan.discovers-project-manifests @verified @source:extensions/nvim/lua/depwatch/discover.lua#manifests @test:extensions/nvim/tests/init_spec.lua#lists them shallowest first, because the root one is the one meant @test:extensions/nvim/tests/init_spec.lua#never descends into an excluded directory @test:extensions/nvim/tests/init_spec.lua#stops at max_manifests @questionable
  Scenario: Project scans find manifests shallowest first, skip excluded folders, and stop at the limit
    Given the project has package.json, web/package.json, web/deep/package.json and node_modules/left-pad/package.json
    And max_manifests is set to 2
    When the developer scans the whole project
    Then package.json and web/package.json are scanned, in that order
    And web/deep/package.json is not scanned
    And nothing under node_modules is scanned

  @id:editor-integration.editor-commands.003 @rule:editor.scan.empty-manifest-is-not-a-failure @verified @source:extensions/nvim/lua/depwatch/init.lua#scan @test:extensions/nvim/tests/init_spec.lua#treats a manifest with no dependencies as normal, not as a failure
  Scenario: A manifest with no dependencies is not reported as a problem
    Given package.json declares no dependencies
    When the developer runs :DepwatchScan on package.json
    Then no warning is shown
    And package.json has no findings and no marks

  @id:editor-integration.editor-commands.004 @rule:editor.scan.failure-is-reported @verified @source:extensions/nvim/lua/depwatch/init.lua#scan @test:extensions/nvim/tests/init_spec.lua#reports a manifest it genuinely could not read @test:extensions/nvim/tests/init_spec.lua#refuses output that is not a depwatch report
  Scenario Outline: A scan that produces no usable report tells the developer why
    Given depwatch <outcome> for package.json
    When the developer runs :DepwatchScan on package.json
    Then the developer sees the <level> "<message>"
    And package.json keeps no findings from this scan

    Examples:
      | outcome                                   | level   | message                                                                    |
      | fails with "Cargo.toml is not valid TOML" | warning | depwatch: package.json: Cargo.toml is not valid TOML                       |
      | prints JSON that is not a depwatch report | error   | depwatch: package.json: unexpected output — is `cmd` pointing at depwatch? |

  @id:editor-integration.editor-commands.005 @rule:editor.scan.missing-cli-reported-once @inferred @source:extensions/nvim/lua/depwatch/cli.lua#run
  Scenario: A missing depwatch executable is reported once per session
    Given the configured command "depwatch" is not installed
    When the plugin scans every manifest on startup
    Then the developer sees one error "depwatch: could not run `depwatch` — see :checkhealth depwatch"
    And later scans in the same session show that error again

  @id:editor-integration.editor-commands.006 @rule:editor.scan.disabled-plugin-never-scans @verified @source:extensions/nvim/lua/depwatch/init.lua#setup @test:extensions/nvim/tests/init_spec.lua#does nothing at all when the plugin is disabled
  Scenario: A disabled plugin scans nothing and shows no marks
    Given the plugin is configured with enabled = false
    When the developer runs :DepwatchScanAll
    Then no manifest is scanned
    And no findings are shown in any manifest
