@domain:reporting @area:quadrant-chart @from:src/quadrant
Feature: Plotting dependencies on the drift × viability quadrant chart
  Gives maintainers and reviewers one standalone picture that sorts every scored dependency into leave it, upgrade it, watch it or replace it, so they can commit it, attach it to a pull request or open it in a browser.

  Background:
    Given a manifest whose dependencies have been scored for drift and viability

  @id:reporting.quadrant-chart.001 @rule:reporting.quadrant-chart.regions-split-at-thresholds @inferred @source:src/quadrant.ts#quadrantSVG
  Scenario Outline: The chart is split into four named quadrants at the drift and viability thresholds
    Given the stale threshold is <stale> libyears and the risky threshold is <risky> viability
    When the maintainer renders the quadrant chart
    Then the chart shows the regions "Healthy", "Upgrade — behind but alive", "Watch — current but fading" and "Replace — behind and unmaintained"
    And a dashed vertical divider sits at <stale> libyears and a dashed horizontal divider sits at <risky> viability
    And the x axis reads "libyears behind →" and the y axis reads "viability →" with ticks 0.00, 0.25, 0.50, 0.75, 1.00
    And each dependency is drawn as a point coloured by its quadrant verdict

    Examples:
      | stale | risky |
      | 1     | 0.5   |
      | 2     | 0.3   |

  @id:reporting.quadrant-chart.002 @rule:reporting.quadrant-chart.unscored-deps-counted-not-plotted @verified @source:src/quadrant.ts#quadrantSVG @test:src/manifest.test.ts#plots scored deps and notes the ones it could not score @questionable
  Scenario Outline: Dependencies without a drift score are left off the chart and counted
    Given the manifest has 2 scored dependencies and 1 dependency that is <state>
    When the maintainer renders the quadrant chart
    Then only the 2 scored dependencies appear as points
    And the chart's top-right corner reads "1 not plotted (no registry data)"

    Examples:
      | state                                                  |
      | unreachable at its registry                            |
      | pulse-only (a Docker image with no orderable versions) |

  @id:reporting.quadrant-chart.003 @rule:reporting.quadrant-chart.labels-off-healthy-by-default @verified @source:src/quadrant.ts#quadrantSVG @test:src/manifest.test.ts#plots scored deps and notes the ones it could not score
  Scenario Outline: Only dependencies outside the healthy quadrant are named unless every label is requested
    Given a dependency "left-pad" in the healthy quadrant
    And a dependency "request" in the replace quadrant
    When the maintainer renders the quadrant chart <with label-all>
    Then "request" is labelled next to its point
    And "left-pad" <healthy label>

    Examples:
      | with label-all              | healthy label                   |
      | without asking to label all | is drawn as an unlabelled point |
      | asking to label all         | is labelled next to its point   |

  @id:reporting.quadrant-chart.004 @rule:reporting.quadrant-chart.labels-stay-inside-chart @verified @source:src/quadrant.ts#quadrantSVG @test:src/manifest.test.ts#flips a label to the left of a point that would clip it @test:src/manifest.test.ts#keeps a label on the right when there is room
  Scenario Outline: A label that would run off the right edge is placed to the left of its point
    Given a dependency named "<name>" in the upgrade quadrant, <libyears> libyears behind
    When the maintainer renders the quadrant chart
    Then the label "<name>" is drawn on the <side> of its point
    And the label stays within the chart's 760-pixel width

    Examples:
      | name                     | libyears | side  |
      | a-very-long-package-name | 8        | left  |
      | ab                       | 0.1      | right |

  @id:reporting.quadrant-chart.005 @rule:reporting.quadrant-chart.package-names-escaped @verified @source:src/quadrant.ts#escapeXml @test:src/manifest.test.ts#escapes package names rather than emitting raw markup
  Scenario: Package names with markup characters are shown as text and never break the chart
    Given a dependency named "<script>&" in the replace quadrant
    When the maintainer renders the quadrant chart
    Then the label reads "<script>&" as plain text
    And the chart contains no raw "<script>" element and opens as valid SVG

  @id:reporting.quadrant-chart.006 @rule:reporting.quadrant-chart.shared-quadrant-palette @inferred @source:src/quadrant.ts#QUADRANT_COLOR
  Scenario Outline: Each quadrant has one colour, shared by the chart and the editor report
    Given a dependency in the <quadrant> quadrant
    When the maintainer renders the quadrant chart
    Then its point and region are coloured <colour>
    And the editor's report uses <colour> for <quadrant> whenever the editor theme supplies no chart colour

    Examples:
      | quadrant | colour  |
      | healthy  | #4ec9a4 |
      | upgrade  | #e8b73a |
      | watch    | #5aa9e6 |
      | replace  | #f2665e |
