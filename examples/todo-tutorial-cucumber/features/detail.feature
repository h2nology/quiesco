# The details screen. A backdoor puts todos in the list, so these scenarios do not type them in first.
Feature: Todo details

  Background:
    Given these todos:
      | title            | notes         |
      | Buy milk         | Oat milk, 1 l |
      | Call the dentist |               |

  Scenario: A todo opens on its own screen
    When I open the todo "Buy milk"
    Then I see the details of "Buy milk" with the notes "Oat milk, 1 l"
    When I go back
    Then I see the list

  Scenario: Marking a todo done shows in the list
    When I open the todo "Call the dentist"
    And I mark it as done
    Then its status is "Done"
    When I go back
    Then todo 2 is checked
    And todo 1 is not checked
    And the summary reads "1 of 2 done"

  Scenario: The checkbox in the list toggles a todo
    When I check todo 1
    Then todo 1 is checked
    And the summary reads "1 of 2 done"

  Scenario: Deleting a todo goes back to the list without it
    When I open the todo "Buy milk"
    And I delete it
    Then I see the list
    And the list has 1 todo
    And there is no todo "Buy milk"
