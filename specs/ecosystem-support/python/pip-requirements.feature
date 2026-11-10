@domain:ecosystem-support @area:python @from:libyear/engine
Feature: Reading pip requirements files
  Lets Python teams score drift from a requirements.txt, treating exact pins as installed versions and other specifiers as floors.

  @id:ecosystem-support.python.023 @rule:python.requirements.pins-resolved-others-floor @verified @source:src/lib/libyear/engine.ts#parseRequirements @test:src/lib/engine.test.ts#resolves == pins in requirements.txt but not the other operators @questionable
  Scenario Outline: An exact pin is an installed version; any other specifier is read as a declared floor
    Given requirements.txt contains the line "<line>"
    When the operator checks the requirements file
    Then "requests" is listed at <version>
    And "requests" is marked as <resolution>

    Examples:
      | line             | version | resolution   |
      | requests==2.31.0 | 2.31.0  | resolved     |
      | requests>=2.28   | 2.28    | not resolved |
      | requests~=2.31.0 | 2.31.0  | not resolved |
      | requests<3       | 3       | not resolved |
      | requests!=2.30.0 | 2.30.0  | not resolved |

  @id:ecosystem-support.python.025 @rule:python.requirements.extras-and-inline-comments-stripped @verified @source:src/lib/libyear/engine.ts#parseRequirements @test:src/lib/engine.test.ts#resolves == pins in requirements.txt but not the other operators
  Scenario: Extras and trailing comments do not change the package name or version
    Given requirements.txt contains the line "flask[async] >= 3.0  # inline"
    When the operator checks the requirements file
    Then "flask" is listed at 3.0
    And "flask" is marked as not resolved
