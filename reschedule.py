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

    def __init__(self, n, f, p, s, d):
        self.name = n
        self.fixed=f
        self.start_time=s
        self.duration=d
        self.priority=p

    def __str__(self):
        return json.dumps({
            "name": self.name,
            "fixed": self.fixed,
            "priority": self.priority,
            "start_time": self.start_time.strftime("%H:%M"),
            "duration": self.duration.strftime("%H:%M")
        })

def extract_tasks_from_json(file_path):
    with open(file_path, 'r') as file:
        data = json.load(file)

    tasks = []
    for task_data in data['tasks']:
        name = task_data['name']
        fixed = task_data['fixed']
        priority = task_data['priority']
        start_time = datetime.strptime(task_data['start_time'], "%H:%M").time()
        duration = datetime.strptime(task_data['duration'], "%H:%M").time()
        
        task = Task(name, fixed, priority, start_time, duration)
        tasks.append(task)

    return tasks

tasks = extract_tasks_from_json("original_tasks.json")
for task in tasks:
    print(str(task))

