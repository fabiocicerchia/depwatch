@domain:drift @area:trend @from:src/trend
Feature: Tracking drift over a manifest's history
  Lets a team see whether a manifest has been getting fresher or staler by scoring it at points through its own git history.

  Background:
    Given the manifest is tracked in a git repository

  @id:drift.trend.001 @rule:drift.trend.score-each-revision-as-of-its-commit-date @inferred @source:src/trend.ts#trend
  Scenario: Each historical point is scored as the dependencies stood on that commit's date
    Given the manifest has been committed several times over the past years
    When the operator runs the trend for the manifest
    Then each point shows the short commit id, the commit date, the total libyears, the number of dependencies and how many sit in the replace quadrant
    And each point's libyears ignore releases published after that commit's date
    And the points are listed oldest first

  @id:drift.trend.002 @rule:drift.trend.sample-evenly-up-to-max-points @inferred @source:src/trend.ts#trend @questionable
  Scenario Outline: Long histories are sampled evenly down to the requested number of points
    Given the manifest has <commits> commits in its history
    When the operator runs the trend with a maximum of <max> points
    Then the trend shows <points> points
    And the newest commit is always one of them

    Examples:
      | commits | max | points |
      | 5       | 12  | 5      |
      | 400     | 12  | 12     |
      | 24      | 12  | 12     |
      | 13      | 12  | 7      |

  @id:drift.trend.003 @rule:drift.trend.refuse-file-without-history @inferred @source:src/trend.ts#trend
  Scenario: A manifest with no git history is refused
    Given the manifest "package.json" has never been committed
    When the operator runs the trend for the manifest
    Then the trend fails with "no git history for package.json"

  @id:drift.trend.004 @rule:drift.trend.missing-git-names-install-command @verified @source:src/trend.ts#git @test:src/trend.test.ts#names the install command and stays recognisable @test:src/trend.test.ts#does not mistake an ordinary git failure for a missing one
  Scenario Outline: Without git installed, the trend says how to install it
    Given git is not installed on a <platform> machine
    When the operator runs the trend for the manifest
    Then the trend fails with "git is not installed. Install it with: <install command>"
    And the failure stays recognisable as a missing program so the editor can offer to install git

    Examples:
      | platform | install command             |
      | macOS    | brew install git            |
      | Windows  | winget install --id Git.Git |
      | Linux    | sudo apt install git        |

  @id:drift.trend.005 @rule:drift.trend.skip-unreadable-revisions @inferred @source:src/trend.ts#trend @questionable
  Scenario: Revisions where the manifest was under another name are left out of the trend
    Given the manifest was renamed partway through its history
    When the operator runs the trend for the manifest under its current name
    Then sampled commits from before the rename are left out without a warning
    And the trend shows only points where the manifest existed under its current name
