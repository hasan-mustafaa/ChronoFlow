from openai import OpenAI
from datetime import time, datetime, date, timedelta
import json
client = OpenAI()

# Rescheduling done by GPT 5 mini
def ask(prompt):
    response = client.responses.create(
        model="gpt-5-mini",
        input=prompt
    )

    return response.output_text


class Task:
    name: str
    fixed: bool
    priority: int  # -1 (Undetermined), 0 (low) - 2 (high)
    start_date: date | None
    start_time: time | None
    end_time: time | None
    duration: int | None  # in minutes
    _type: str

    def __init__(self, n, f, p, sd, st, et, d, t):
        self.name = n
        self.fixed = f
        self.priority = p
        self.start_date = sd
        self.start_time = st
        self.end_time = et
        self.duration = d
        self._type = t

    def __str__(self):
        return json.dumps({
            "name": self.name,
            "fixed": self.fixed,
            "priority": self.priority,
            "start_date": self.start_date.strftime("%Y-%m-%d") if self.start_date else "",
            "start_time": self.start_time.strftime("%H:%M") if self.start_time else "",
            "end_time": self.end_time.strftime("%H:%M") if self.end_time else "",
            "duration": self.duration if self.duration else "",
            "type": self._type
        })

def in_minutes(t):
    return t.hour * 60 + t.minute

def add_minutes(t, minutes):
    full_minutes = in_minutes(t) + minutes
    return datetime.strptime(f"{full_minutes//60:02d}:{full_minutes%60:02d}", "%H:%M").time()

def extract_data_from_json(file_path):
    with open(file_path, "r") as file:
        data = json.load(file)

    times = data.get("times", {})
    tasks = []
    for task_data in data["tasks"]:
        name = task_data["name"]
        fixed = task_data["fixed"]
        priority = task_data.get("priority", -1)

        sd = None
        if task_data.get("start_date"):
            sd = datetime.strptime(task_data["start_date"], "%Y-%m-%d").date()
        st = None
        if task_data.get("start_time"):
            st = datetime.strptime(task_data["start_time"], "%H:%M").time()
        et = None
        if task_data.get("end_time"):
            et = datetime.strptime(task_data["end_time"], "%H:%M").time()
        d = None
        if task_data.get("duration"):
            d = int(task_data["duration"])  # duration in minutes

        _type = task_data["type"]

        task = Task(name, fixed, priority, sd, st, et, d, _type)
        tasks.append(task)

    return times, tasks


def validate(times, tasks, to_validate):
    # Build lookup for original tasks
    task_dict = {t.name: t for t in tasks}
    task_names = set(task_dict.keys())
    output_names = {t["name"] for t in to_validate}

    # Check missing or extra tasks
    for name in task_names - output_names:
        return False, f"You did not add {name} in your output.\n"
    for name in output_names - task_names:
        return False, f"You added an extra task {name} in your output.\n"

    # Parse output into Task-like dicts for validation
    output_tasks = []
    for t in to_validate:
        orig = task_dict[t["name"]]
        start_date = datetime.strptime(t["start_date"], "%Y-%m-%d").date()
        start_time = datetime.strptime(t["start_time"], "%H:%M").time()
        end_time = datetime.strptime(t["end_time"], "%H:%M").time()
        duration = int(t["duration"])

        # check duration consistency
        actual_duration = in_minutes(end_time) - in_minutes(start_time)
        if actual_duration != duration:
            return False, f"Task {t['name']} has inconsistent duration: expected {actual_duration}, got {duration}.\n"

        output_tasks.append({
            "name": t["name"],
            "start_date": start_date,
            "start_time": start_time,
            "end_time": end_time,
            "duration": duration,
            "fixed": orig.fixed,
            "priority": t["priority"],
            "type": orig._type
        })

    # Fixed task validation
    for t in output_tasks:
        if t["fixed"]:
            orig = task_dict[t["name"]]
            if t["start_date"] != orig.start_date or t["start_time"] != orig.start_time:
                return False, f"Fixed task {t['name']} has changed start date or time.\n"

    # Priority validation
    for t in output_tasks:
        orig = task_dict[t["name"]]
        if orig.priority != -1 and t["priority"] != orig.priority:
            return False, f"Task {t['name']} has changed its priority improperly.\n"

    # Type time window validation
    for t in output_tasks:
        t_type = t["type"]
        start_limit = datetime.strptime(times[t_type]["start"], "%H:%M").time()
        end_limit = datetime.strptime(times[t_type]["end"], "%H:%M").time()

        if in_minutes(t["start_time"]) < in_minutes(start_limit):
            return False, f"Task {t['name']} starts before allowed {t_type} start time.\n"
        if in_minutes(t["end_time"]) > in_minutes(end_limit):
            return False, f"Task {t['name']} ends after allowed {t_type} end time.\n"

    # Overlap check
    output_tasks.sort(key=lambda x: (x["start_date"], x["start_time"]))
    for i in range(len(output_tasks) - 1):
        t1, t2 = output_tasks[i], output_tasks[i + 1]
        if t1["start_date"] != t2["start_date"]:
            continue
        if in_minutes(t1["end_time"]) > in_minutes(t2["start_time"]):
            return False, f"Tasks {t1['name']} and {t2['name']} overlap.\n"

    return True, "All validations passed."

prompt = f"""
You are a scheduling assistant. 
You are given task data with some missing start times, start dates, or durations. 
Your job is to fill in ALL missing values and output a COMPLETE schedule as valid JSON.
Priority of -1 indicates you should generate the priority as well (between 0-2).

Rules:
- The JSON you output must have the structure:
    {{
        "tasks": [
        {{
        "name": "...",
        "fixed": true/false,
        "priority": 0-2,
        "start_date": "YYYY-MM-DD",
        "start_time": "HH:MM",
        "duration": "HH:MM",
        "type": "personal|business|school"
        }}
        ]
    }}
- Fixed tasks cannot change their date or time.
- Tasks cannot overlap.
- Tasks must fit within the time windows provided:
  {json.dumps(times, indent=4)}

Here is the current task data:
{json.dumps(tasks_data, indent=4)}

Now generate a new, valid schedule JSON with all missing values filled in.
"""



times, tasks = extract_data_from_json("user_data.json")
with open("test_output.json", "r") as file:
    data = json.load(file)["tasks"]

isValid, output = validate(times, tasks, data)
print(isValid, output)

for t_type, t_range in times.items():
    print(f"{t_type.capitalize()} hours: {t_range['start']} to {t_range['end']}")
for task in tasks:
    print(str(task))

