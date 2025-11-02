import re
from datetime import datetime, timedelta

# Compute visible length ignoring ANSI codes
def visible_len(s):
    ansi_escape = re.compile(r'\033\[[0-9;]*m')
    return len(ansi_escape.sub('', s))

# Pad a string to the right with visible width
def ljust_visible(s, width):
    pad = width - visible_len(s)
    return s + " " * max(pad, 0)

YELLOW = "\033[93m"
RESET = "\033[0m"

class WeeklyCalendar:
    def __init__(self):
        self.start_hour, self.end_hour = 6, 21
        self.time_col_width = 8
        self.col_width = 29
        self.row_height = 2
        self.header_offset = 1

        # Current week
        today = datetime.today()
        self.monday = today - timedelta(days=today.weekday())  # Start of the week (Monday)
        self.days = [(self.monday + timedelta(days=i)) for i in range(7)]  # List of days (Mon-Sun)
        self.day_names = [day.strftime("%A").upper() for day in self.days]  # Day names (e.g., Monday, Tuesday, etc.)

        self.calendar = {
            hour: {day: [""] * self.row_height for day in self.day_names}
            for hour in range(self.start_hour, self.end_hour + 1)
        }

    def write_task(self, date_str, hour, task_name, start_time, end_time, fixed=False, priority=0):
        date_obj = datetime.strptime(date_str, "%Y-%m-%d")

        day_name = date_obj.strftime("%A").upper()

        start_hour = int(start_time.split(":")[0])
        end_hour = int(end_time.split(":")[0])

        line1 = task_name[:self.col_width]
        priority_str = "+" * (priority + 1)
        space_width = self.col_width - len(f"{start_time}-{end_time}") - len(priority_str)
        line2 = f"{start_time}-{end_time}" + " " * max(space_width, 0) + priority_str

        if fixed:
            line1 = f"{YELLOW}{line1}{RESET}"
            line2 = f"{YELLOW}{line2}{RESET}"

        self.calendar[start_hour][day_name][0] = ljust_visible(line1, self.col_width)
        self.calendar[start_hour][day_name][1] = ljust_visible(line2, self.col_width)

        # For the hours after the first hour, mark them as "Occupied"
        for hour in range(start_hour + 1, end_hour):
            self.mark_hour_occupied(date_str, hour, fixed)

    def mark_hour_occupied(self, date_str, hour, fixed=False):
        try:
            date_obj = datetime.strptime(date_str, "%Y-%m-%d")
        except ValueError:
            raise ValueError(f"Invalid date format: {date_str}. Use YYYY-MM-DD.")

        day_name = date_obj.strftime("%A").upper()
        if day_name not in self.day_names:
            raise ValueError(f"Date {date_str} is not in the current week")

        occupied_text = "Occupied"
        
        if fixed:
            occupied_text = f"{YELLOW}{occupied_text}{RESET}"

        self.calendar[hour][day_name][0] = ljust_visible(occupied_text, self.col_width)

    def draw_line(self, left, mid, right, junction, adjust=0):
        line = left + "─" * (self.time_col_width - adjust)
        for _ in self.day_names:
            line += junction + "─" * (self.col_width - adjust)
        line += right
        print(line)

    def render(self):
        total_inner_width = self.time_col_width + 1 + len(self.day_names) * (self.col_width + 1)

        print("┌" + "─" * (total_inner_width - self.header_offset) + "┐")

        # Title with week range
        week_start = self.monday.strftime("%Y-%m-%d")
        week_end = (self.monday + timedelta(days=6)).strftime("%Y-%m-%d")
        title = f"WEEK FROM {week_start} TO {week_end}"
        total_space = (total_inner_width - self.header_offset) - len(title)
        left_pad = total_space // 2
        right_pad = total_space - left_pad
        print("│" + " " * left_pad + title + " " * right_pad + "│")

        print("├" + "─" * (total_inner_width - self.header_offset) + "┤")

        # Header row
        header = "│" + "  TIME  │"
        for day_name in self.day_names:
            header += day_name.center(self.col_width) + "│"
        print(header)

        # Divider under header
        self.draw_line("├", "─", "┤", "┼")

        # Hour rows
        for hour in range(self.start_hour, self.end_hour + 1):
            for line_idx in range(self.row_height):
                row = "│"
                if line_idx == 0:
                    row += f" {hour:02d}:00  │"
                else:
                    row += " " * self.time_col_width + "│"

                for day_name in self.day_names:
                    content = self.calendar[hour][day_name][line_idx]
                    row += content.ljust(self.col_width) + "│"
                print(row)
            self.draw_line("├", "─", "┤", "┼")

        self.draw_line("└", "─", "┘", "┴")



# Example
if __name__ == "__main__":
    cal = WeeklyCalendar()

    today = datetime.today()
    monday_str = (today - timedelta(days=today.weekday())).strftime("%Y-%m-%d")
    wednesday_str = (today - timedelta(days=today.weekday()) + timedelta(days=2)).strftime("%Y-%m-%d")
    friday_str = (today - timedelta(days=today.weekday()) + timedelta(days=4)).strftime("%Y-%m-%d")

    cal.write_task(monday_str, 9, "Morning Meeting", "09:00", "10:00", fixed=True, priority=2)
    cal.write_task(wednesday_str, 14, "Code Review", "14:00", "15:00", fixed=False, priority=1)
    cal.write_task(friday_str, 16, "Gym", "16:00", "17:00", fixed=False, priority=0)

    cal.render()

