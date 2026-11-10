@domain:ecosystem-support @area:python @from:ecosystems/pypi
Feature: Measuring Python dependencies published on PyPI
  Lets Python teams score the drift and viability of the packages declared in their requirements files and Poetry/uv lock files against PyPI, so a Python project gets the same two-axis verdict as any other ecosystem.

  Background:
    Given PyPI is the registry depwatch scores Python packages against

  @id:ecosystem-support.python.008 @rule:ecosystem-support.python.requirements-files-recognised @verified @source:src/ecosystems/pypi.ts#pypi @test:src/ecosystems/registry.test.ts#resolves files to the right ecosystem @test:src/manifest.test.ts#maps conventional manifest names
  Scenario Outline: Any file whose name starts with "requirements" is read as a PyPI manifest
    Given a project containing a file named <file>
    When the developer runs a check on that file
    Then the file is read as a PyPI manifest
    And its dependencies are looked up on PyPI

    Examples:
      | file                               |
      | requirements.txt                   |
      | requirements-dev.txt               |
      | services/api/requirements-prod.txt |

  @id:ecosystem-support.python.010 @rule:ecosystem-support.python.requirements-non-package-lines-ignored @verified @source:src/lib/libyear/engine.ts#parseRequirements @test:src/lib/engine.test.ts#resolves == pins in requirements.txt but not the other operators @questionable
  Scenario Outline: Includes, options, comments and unversioned requirements are not reported as dependencies
    Given a requirements file containing the line "<line>"
    When the developer runs a check on that file
    Then no dependency is reported for that line
    And no warning is shown for it

    Examples:
      | line                       |
      | -r base.txt                |
      | -e .                       |
      | # pinned for CVE-2024-0001 |
      | rich                       |

  @id:ecosystem-support.python.013 @rule:ecosystem-support.python.deep-funding-from-project-links @inferred @source:src/ecosystems/pypi.ts#pypi
  Scenario Outline: With deep analysis a PyPI package counts as funded when one of its project links is a funding link
    Given a PyPI package whose project links include one labelled "<label>"
    When the developer runs a check with deep analysis
    Then the package is reported as funded: <funded>

    Examples:
      | label         | funded |
      | Funding       | yes    |
      | Sponsor       | yes    |
      | Donate        | yes    |
      | Documentation | no     |

  @id:ecosystem-support.python.014 @rule:ecosystem-support.python.deep-repository-from-project-links @inferred @source:src/ecosystems/pypi.ts#pypi @questionable
  Scenario Outline: With deep analysis a PyPI package's last commit and archived status come from the repository its project links point to
    Given a PyPI package whose project link "<label>" points to https://github.com/example-org/example-lib
    And the package's home page is https://example.com
    When the developer runs a check with deep analysis
    Then the archived status and last commit date are taken from <repository>

    Examples:
      | label       | repository                                                                                                       |
      | Source      | github.com/example-org/example-lib                                                                               |
      | Source Code | github.com/example-org/example-lib                                                                               |
      | GitHub      | github.com/example-org/example-lib                                                                               |
      | Bug Tracker | nowhere: the home page https://example.com is used instead, which is not on GitHub, so no repository data is read |

  @id:ecosystem-support.python.015 @rule:ecosystem-support.python.bus-factor-unknown @inferred @source:src/ecosystems/pypi.ts#pypi
  Scenario: A PyPI package's maintainer count is always unknown and does not lower its viability
    Given a PyPI package with any number of listed authors
    When the developer runs a check with deep analysis
    Then the package's maintainer count is reported as unknown
    And its viability score is computed from the other signals that are present
