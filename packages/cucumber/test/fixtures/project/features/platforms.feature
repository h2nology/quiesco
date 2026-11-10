@native
Feature: Platform tags, innermost level wins

  @ios
  Scenario: ios only inside a native feature
    When I tap "ios-only"

  Scenario: inherits native
    When I tap "inherited"

  @web
  Rule: web rule

    @android
    Scenario: android inside a web rule
      When I tap "rule-android"

    Scenario: inherits the web rule
      When I tap "rule-web"

  @ios
  Scenario Outline: examples decide <x>
    When I tap "<x>"

    @android
    Examples:
      | x          |
      | ex-android |

    Examples:
      | x      |
      | ex-ios |
