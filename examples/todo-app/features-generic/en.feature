# language: en
Feature: Generic steps (English)
  The English steps of @quiesco/steps drive the example app.

  Scenario: Value controls and state assertions
    Given 通过后门 "openControls" 打开页面 "controls"
    When I set the slider "volume" to 35
    Then the element "volume-value" has the text "35"
    When I turn on the switch "notify"
    Then the element "notify" is checked
    When I select "榴莲" in "fruit"
    Then the element "fruit-value" has the text "fruit-3"

  Scenario: Log in and add a todo with the enter key
    When I type "en@example.com" into "email"
    And I type "secret" into "password"
    And I tap "login-button"
    Then the element "greeting" has the text "en@example.com"
    When I tap "add-todo"
    And I type "Buy milk" into "todo-title"
    And I press enter in "todo-title"
    Then there are 1 elements "todo-item"

  Scenario: Appearance and orientation
    Given 通过后门 "openDevice" 打开页面 "device"
    When I switch to dark mode
    Then the element "color-scheme" has the text "dark"
    When I rotate the device to landscape
    Then the element "orientation" has the text "landscape"
