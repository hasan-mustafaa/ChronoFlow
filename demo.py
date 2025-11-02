import json
from datetime import datetime
from weeklyCalendar import WeeklyCalendar

def load_data(file_path):
    """Load the user task data from the given JSON file."""
    with open(file_path, 'r') as f:
        return json.load(f)

def add_tasks_to_calendar(user_data, calendar):
    """Add tasks from user data to the calendar."""
    for task in user_data.get('tasks', []):
        date_str = task.get('start_date')
        start_time = task.get('start_time')
        end_time = task.get('end_time')
        task_name = task.get('name')
        fixed = task.get('fixed', False)
        priority = task.get('priority', 0)

        if not date_str or not start_time or not end_time:
            # print(f"Skipping task '{task_name}' due to missing date or time information.")
            continue
        
        # Determine the hour from the start time (assuming it's in HH:MM format)
        try:
            start_hour = int(start_time.split(":")[0])
        except ValueError:
            # print(f"Invalid start time for task '{task_name}'. Skipping task.")
            continue
        
        calendar.write_task(date_str, start_hour, task_name, start_time, end_time, fixed, priority)



def main():
    user_data = load_data('user_data.json')

    old_calendar = WeeklyCalendar()

    add_tasks_to_calendar(user_data, old_calendar)

    old_calendar.render()
    #prompt "Proceed?" Wait till return pressed
    #run reschedule
    new_calendar = WeeklyCalendar()

    updated_data = load_data('updated_data.json')

    new_calendar = WeeklyCalendar()

    add_tasks_to_calendar(updated_data, new_calendar)
    new_calendar.render()

if __name__ == "__main__":
    main()

