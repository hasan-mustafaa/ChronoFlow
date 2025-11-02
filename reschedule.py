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
    with open(file_path, 'r') as file:
        data = json.load(file)

    times = data['times']
    tasks = []
    for task_data in data['tasks']:
        name = task_data['name']
        fixed = task_data['fixed']
        priority = task_data['priority']
        start_date = datetime.strptime(task_data['start_date'], "%Y-%m-%d").date()
        start_time = datetime.strptime(task_data['start_time'], "%H:%M").time()
        duration = datetime.strptime(task_data['duration'], "%H:%M").time()
        _type = task_data['type']
        
        task = Task(name, fixed, priority, start_date, start_time, duration, _type)
        tasks.append(task)

    return times, tasks


def validate(times, tasks, to_validate):
    task_dict = {t.name: t for t in tasks}
    task_names = set(task_dict.keys())
    output_names = {t["name"] for t in to_validate}

    for name in task_names:
        if name not in output_names:
            return False, f"You did not add {name} in your output.\n"

    for name in output_names:
        if name not in task_names:
            return False, f"You added an extra task {name} in your output.\n"

    # duplicate list for easy comparison
    output_tasks = []
    for t in to_validate:
        orig = task_dict[t["name"]]
        start_date = datetime.strptime(t.get("date", orig.start_date.strftime("%Y-%m-%d")), "%Y-%m-%d").date()
        start_time = datetime.strptime(t.get("start_time", orig.start_time.strftime("%H:%M")), "%H:%M").time()
        duration_minutes = orig.duration.hour * 60 + orig.duration.minute
        end_time = add_minutes(start_time, duration_minutes)
        output_tasks.append({
            "name": t["name"],
            "start_date": start_date,
            "start_time": start_time,
            "end_time": end_time,
            "fixed": orig.fixed,
            "type": orig._type
        })

    for t in output_tasks:
        if t["fixed"]:
            orig = task_dict[t["name"]]
            if t["start_date"] != orig.start_date or t["start_time"] != orig.start_time:
                return False, f"Fixed task {t['name']} has changed start date or time.\n"


    for t in output_tasks:
        t_type = t["type"]
        start_limit = datetime.strptime(times[t_type]["start"], "%H:%M").time()
        end_limit = datetime.strptime(times[t_type]["end"], "%H:%M").time()

        t_start_min = in_minutes(t["start_time"])
        t_end_min = in_minutes(t["end_time"])
        start_min = in_minutes(start_limit)
        end_min = in_minutes(end_limit)
        if t_start_min < start_min:
            return False, f"Task {t['name']} starts before allowed {t_type} start time {start_limit.strftime('%H:%M')}.\n"
        if t_end_min > end_min:
            return False, f"Task {t['name']} ends after allowed {t_type} end time {end_limit.strftime('%H:%M')}.\n"

    # O(n^2) I know
    for i in range(len(output_tasks)):
        t1 = output_tasks[i]
        for j in range(i+1, len(output_tasks)):
            t2 = output_tasks[j]
            if t1["start_date"] != t2["start_date"]:
                continue
            t1_start = in_minutes(t1["start_time"])
            t1_end = in_minutes(t1["end_time"])
            t2_start = in_minutes(t2["start_time"])
            t2_end = in_minutes(t2["end_time"])

            if not (t1_end <= t2_start or t2_end <= t1_start):
                return False, f"Tasks {t1['name']} and {t2['name']} overlap"

    return True

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
with open("test_output.json", 'r') as file:
    data = json.load(file)["tasks"]
isValid, output = validate(times, tasks, data)
print(isValid, output)

for t_type, t_range in times.items():
    print(f"{t_type.capitalize()} hours: {t_range['start']} to {t_range['end']}")
for task in tasks:
    print(str(task))

