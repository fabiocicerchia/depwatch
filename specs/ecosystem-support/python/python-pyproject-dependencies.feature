@domain:ecosystem-support @area:python @from:ecosystems/python
Feature: Reading dependencies from pyproject.toml
  Lets Python teams using Poetry, uv or pip measure the drift of the dependencies declared in pyproject.toml without exporting a requirements file.

  Background:
    Given the project's manifest is a pyproject.toml resolved against PyPI

  @id:ecosystem-support.python.016 @rule:python.pyproject.poetry-tables-give-version-floors @verified @source:src/ecosystems/python.ts#parsePoetryPyproject @test:src/ecosystems/python.test.ts#reads a poetry [tool.poetry.dependencies] table
  Scenario Outline: Poetry dependency tables are read at the floor of each stated range
    Given the pyproject.toml has a [tool.poetry] section
    And its <table> lists <entry>
    When the operator checks the manifest
    Then the report lists <package> at version <current>
    And <package> is marked as a range floor, not a pinned version

    Examples:
      | table                                | entry                                                  | package  | current |
      | [tool.poetry.dependencies]           | requests = "^2.31.0"                                   | requests | 2.31.0  |
      | [tool.poetry.dependencies]           | django = { version = ">=4.2,<5", extras = ["bcrypt"] } | django   | 4.2     |
      | [tool.poetry.group.dev.dependencies] | pytest = "^8.1.0"                                      | pytest   | 8.1.0   |

  @id:ecosystem-support.python.017 @rule:python.pyproject.pep621-arrays-give-floors-or-pins @verified @source:src/ecosystems/python.ts#parsePep621Pyproject @test:src/ecosystems/python.test.ts#reads a PEP 621 [project] dependencies array (uv/pip)
  Scenario Outline: PEP 621 dependency arrays report exact pins as pinned and ranges at their floor
    Given the pyproject.toml has a [project] table with no [tool.poetry] section
    And its dependencies array contains "<requirement>"
    When the operator checks the manifest
    Then the report shows <outcome>

    Examples:
      | requirement      | outcome                                       |
      | requests>=2.31.0 | requests at 2.31.0 as a range floor           |
      | httpx==0.27.0    | httpx at 0.27.0 as a pinned version           |
      | rich             | no entry for rich, since it states no version |

  @id:ecosystem-support.python.018 @rule:python.pyproject.interpreter-not-a-dependency @verified @source:src/ecosystems/python.ts#isPythonPlatformReq @test:src/ecosystems/python.test.ts#reads a poetry [tool.poetry.dependencies] table
  Scenario: The Python interpreter requirement is never reported as a dependency
    Given the pyproject.toml declares python = "^3.11" among its Poetry dependencies
    When the operator checks the manifest
    Then the report has no entry named python
    And the other declared packages are still listed

  @id:ecosystem-support.python.019 @rule:python.pyproject.package-reported-once @inferred @source:src/ecosystems/python.ts#parsePoetryPyproject
  Scenario: A package declared in several dependency groups is reported once, at its first declaration
    Given the pyproject.toml declares requests = "^2.31.0" in [tool.poetry.dependencies]
    And it also declares requests = "^2.28.0" in [tool.poetry.group.dev.dependencies]
    When the operator checks the manifest
    Then the report lists requests once
    And requests is at version 2.31.0

  @id:ecosystem-support.python.020 @rule:python.pyproject.poetry-section-hides-project-table @inferred @source:src/ecosystems/python.ts#parsePyproject @questionable
  Scenario: A pyproject.toml with any Poetry section is read only through its Poetry tables
    Given the pyproject.toml declares dependencies = ["requests>=2.31.0"] under [project]
    And it also has a [tool.poetry] section with no dependency tables
    When the operator checks the manifest
    Then the report has no dependencies

  @id:ecosystem-support.python.021 @rule:python.pyproject.extras-truncate-dependency-array @inferred @source:src/ecosystems/python.ts#parsePep621Pyproject @questionable
  Scenario: A requirement with extras in a PEP 621 array drops itself and every dependency after it
    Given the pyproject.toml [project] dependencies array is ["requests[security]>=2.31.0", "httpx==0.27.0"]
    When the operator checks the manifest
    Then the report has no entry for requests
    And the report has no entry for httpx

  @id:ecosystem-support.python.022 @rule:python.pyproject.tool-arrays-after-project-swept-in @verified @source:src/ecosystems/python.ts#parsePep621Pyproject @test:src/ecosystems/python.test.ts#reads a PEP 621 [project] dependencies array (uv/pip) @questionable
  Scenario: Arrays in tool tables placed after [project] are read as dependencies
    Given the pyproject.toml has a [project] table with dependencies = ["requests>=2.31.0"]
    And a later [tool.example] table sets plugins = ["black==24.1.0"]
    When the operator checks the manifest
    Then the report lists requests at 2.31.0
    And the report also lists black at 24.1.0 as a pinned version
