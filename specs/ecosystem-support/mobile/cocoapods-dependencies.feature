@domain:ecosystem-support @area:mobile @from:ecosystems/cocoapods
Feature: Scoring CocoaPods dependencies
  Lets iOS and macOS teams measure how far their locked pods lag behind CocoaPods trunk, so Swift and Objective-C projects get the same drift-versus-viability view as other ecosystems.

  Background:
    Given the developer's project uses CocoaPods

  @id:ecosystem-support.mobile.001 @rule:ecosystem.cocoapods.lock-pins-exact-versions @verified @source:src/ecosystems/cocoapods.ts#parsePodfileLock @test:src/ecosystems/phase3.test.ts#reads Podfile.lock PODS and collapses subspecs
  Scenario: Pods locked in Podfile.lock are scored at their exact pinned versions
    Given a Podfile.lock whose PODS section lists "Alamofire (5.8.1)" and "SnapKit (5.6.0)"
    And its DEPENDENCIES section lists "Alamofire (~> 5.8)"
    When the developer checks Podfile.lock
    Then the manifest is reported as the cocoapods ecosystem
    And Alamofire is scored at installed version 5.8.1 as a resolved version
    And SnapKit is scored at installed version 5.6.0 as a resolved version
    And the "~> 5.8" constraint is not reported as a separate dependency

  @id:ecosystem-support.mobile.002 @rule:ecosystem.cocoapods.subspecs-collapse-to-pod @inferred @source:src/ecosystems/cocoapods.ts#parsePodfileLock
  Scenario Outline: A pod's subspecs are counted once under the pod's name
    Given a Podfile.lock whose PODS section lists "<entries>"
    When the developer checks Podfile.lock
    Then the report lists exactly the pods "<reported>"
    And each pod appears once, at the version of its first entry

    Examples:
      | entries                                                           | reported         |
      | Firebase/Analytics (10.18.0), Firebase/Core (10.18.0)             | Firebase 10.18.0 |
      | Alamofire (5.8.1) with nested dependency Alamofire/Core (= 5.8.1) | Alamofire 5.8.1  |

  @id:ecosystem-support.mobile.003 @rule:ecosystem.cocoapods.all-locked-pods-scored @verified @source:src/ecosystems/cocoapods.ts#parsePodfileLock @test:src/ecosystems/phase3.test.ts#reads Podfile.lock PODS and collapses subspecs @questionable
  Scenario: Every pod in the lock file is scored, including ones pulled in by other pods
    Given a Podfile.lock whose PODS section lists "Alamofire (5.8.1)" and "SnapKit (5.6.0)"
    And its DEPENDENCIES section lists only Alamofire
    When the developer checks Podfile.lock without asking for transitive dependencies
    Then both Alamofire and SnapKit appear in the report

  @id:ecosystem-support.mobile.004 @rule:ecosystem.cocoapods.podfile-alone-unrecognised @inferred @source:src/ecosystems/cocoapods.ts#cocoapods
  Scenario: A Podfile without its lock file is not recognised
    Given a project folder containing a Podfile but no Podfile.lock
    When the developer checks the Podfile
    Then the check is refused with "unrecognised input: Podfile (expected a manifest, a lock file, or a CycloneDX/SPDX SBOM)"
    And the CLI help lists only Podfile.lock for CocoaPods

  @id:ecosystem-support.mobile.005 @rule:ecosystem.cocoapods.release-dates-from-trunk @inferred @source:src/ecosystems/cocoapods.ts#cocoapods
  Scenario: Pod drift is measured against the versions and dates published on CocoaPods trunk
    Given CocoaPods trunk lists Alamofire versions 5.8.1 released 2023-10-01 and 5.9.0 released 2024-03-01
    And a Podfile.lock pinning Alamofire 5.8.1
    When the developer checks Podfile.lock
    Then Alamofire's latest version is reported as 5.9.0
    And Alamofire's drift is calculated from the gap between 2023-10-01 and 2024-03-01
