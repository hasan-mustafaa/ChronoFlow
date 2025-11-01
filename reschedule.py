from openai import OpenAI
from datetime import time
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
    fixed: bool
    priority: int # 0 (low) - 2 (high)
    start_time: time
    duration: time

    def __init__(self, f, p, s, d):
        self.fixed=f
        self.start_time=s
        self.duration=d
        self.priority=p

    def __str__(self):
        return json.dumps({
            "fixed": self.fixed,
            "priority": self.priority,
            "start_time": self.start_time.strftime("%H:%M"),
            "duration": self.duration.strftime("%H:%M")
        })

