Feature: Quiesco wiring

  Scenario: runs everywhere
    When I tap "add"
    Then the app saw "tap add"

  @web
  Scenario: web only
    When I tap "web-thing"

  @hard-reset
  Scenario: hard reset
    When I tap "x"

  Scenario: fails with evidence
    When I tap "broken"
