from openai import OpenAI
from datetime import time, datetime
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
    priority: int # 0 (low) - 2 (high)
    start_time: time
    duration: time
    _type: str

    def __init__(self, n, f, p, s, d, t):
        self.name = n
        self.fixed=f
        self.start_time=s
        self.duration=d
        self.priority=p
        self._type=t

    def __str__(self):
        return json.dumps({
            "name": self.name,
            "fixed": self.fixed,
            "priority": self.priority,
            "start_time": self.start_time.strftime("%H:%M"),
            "duration": self.duration.strftime("%H:%M"),
            "type": self._type
        })

def extract_data_from_json(file_path):
    with open(file_path, 'r') as file:
        data = json.load(file)

    times = data['times']
    tasks = []
    for task_data in data['tasks']:
        name = task_data['name']
        fixed = task_data['fixed']
        priority = task_data['priority']
        start_time = datetime.strptime(task_data['start_time'], "%H:%M").time()
        duration = datetime.strptime(task_data['duration'], "%H:%M").time()
        _type = task_data['type']
        
        task = Task(name, fixed, priority, start_time, duration, _type)
        tasks.append(task)

    return times, tasks


def validate(times, tasks, to_validate):
    if len(tasks) != len(to_validate):
        return False
    for task in tasks:
        if task.name not in to_validate:
            print(task)
            print(to_validate)
            return False
    return True



times, tasks = extract_data_from_json("user_data.json")
with open("test_output.json", 'r') as file:
    data = json.load(file)
print(validate(times, tasks, data))

# Test output
for t_type, t_range in times.items():
    print(f"{t_type.capitalize()} hours: {t_range['start']} to {t_range['end']}")
for task in tasks:
    print(str(task))

