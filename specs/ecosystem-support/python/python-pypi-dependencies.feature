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

  @id:ecosystem-support.python.009 @rule:ecosystem-support.python.requirements-pin-versus-floor @verified @source:src/lib/libyear/engine.ts#parseRequirements @test:src/lib/engine.test.ts#resolves == pins in requirements.txt but not the other operators @questionable
  Scenario Outline: Only an exact pin in a requirements file counts as the installed version; any other operator is treated as a lower bound
    Given a requirements file declaring "<line>"
    When the developer runs a check on that file
    Then the dependency <name> is measured from version <current>
    And its installed version is reported as <exactness>

    Examples:
      | line                          | name     | current | exactness                           |
      | requests==2.31.0              | requests | 2.31.0  | exact                               |
      | flask[async] >= 3.0  # inline | flask    | 3.0     | an estimate from the declared floor |
      | django~=4.2.1                 | django   | 4.2.1   | an estimate from the declared floor |
      | urllib3<2.0                   | urllib3  | 2.0     | an estimate from the declared floor |

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

  @id:ecosystem-support.python.011 @rule:ecosystem-support.python.lock-files-give-exact-versions @verified @source:src/ecosystems/parse-util.ts#parsePackageArrayLock @test:src/ecosystems/python.test.ts#reads exact versions from poetry.lock / uv.lock
  Scenario Outline: Poetry and uv lock files report every locked package at its exact version
    Given a <lock> listing certifi 2024.2.2 and charset-normalizer 3.3.2
    When the developer runs a check on that lock file
    Then the report is for the PyPI ecosystem
    And certifi is measured from exactly 2024.2.2
    And charset-normalizer is measured from exactly 3.3.2

    Examples:
      | lock        |
      | poetry.lock |
      | uv.lock     |

  @id:ecosystem-support.python.012 @rule:ecosystem-support.python.sbom-pypi-components-scored @verified @source:src/ecosystems/pypi.ts#pypi @test:src/ecosystems/registry.test.ts#maps PURL types
  Scenario: SBOM components with a PyPI package URL are scored against PyPI
    Given an SBOM containing a component with package URL "pkg:pypi/django@4.2.1"
    When the developer runs a check on the SBOM
    Then django is measured against PyPI from version 4.2.1

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
