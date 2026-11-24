# The list and the new-todo screen, driven only through the UI.
Feature: The todo list

  Scenario: A fresh start shows the empty list
    Then the list is empty

  Scenario: A new todo appears at the top of the list
    When I add a todo "Buy milk" with the notes "Oat milk, 1 l"
    Then the first todo is "Buy milk"
    And the summary reads "0 of 1 done"

  Scenario: A todo needs a title
    When I save a new todo without a title
    Then the form says "Enter a title"
    When I go back
    Then the list is empty

  Scenario: Every scenario starts with an empty list
    # The scenarios above left a todo behind; the soft reset and the onReset hook in src/e2e.ts cleared it.
    Then the list is empty
