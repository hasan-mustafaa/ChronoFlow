from openai import OpenAI
from datetime import time, datetime, date
import json

client = OpenAI()

def ask(prompt):
    response = client.responses.create(
        model="gpt-5-mini",
        input=prompt
    )
    return response.output_text


class Task:
    def __init__(self, uid, n, f, p, sd, st, et, d, t):
        self.uid = uid  
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
            "uid": self.uid,
            "name": self.name,
            "fixed": self.fixed,
            "priority": self.priority,
            "start_date": self.start_date.strftime("%Y-%m-%d") if self.start_date else "",
            "start_time": self.start_time.strftime("%H:%M") if self.start_time else "",
            "end_time": self.end_time.strftime("%H:%M") if self.end_time else "",
            "duration": self.duration if self.duration else 0,
            "type": self._type
        })

def in_minutes(t):
    return t.hour * 60 + t.minute

def add_minutes(t, minutes):
    full_minutes = in_minutes(t) + minutes
    return datetime.strptime(f"{full_minutes//60:02d}:{full_minutes%60:02d}", "%H:%M").time()


def extract_data_from_json(data):
    times = data.get("times", {})
    task_list = data.get("tasks", [])

    tasks = []
    for idx, task_data in enumerate(task_list):
        uid = task_data.get("uid", f"task_{idx}")
        name = task_data["name"]
        fixed = bool(task_data["fixed"])
        priority = int(task_data["priority"])
        sd = datetime.strptime(task_data["start_date"], "%Y-%m-%d").date() if task_data.get("start_date") else None
        st = datetime.strptime(task_data["start_time"], "%H:%M").time() if task_data.get("start_time") else None
        et = datetime.strptime(task_data["end_time"], "%H:%M").time() if task_data.get("end_time") else None
        d = int(task_data["duration"]) if task_data.get("duration") else None
        _type = task_data.get("type", "personal")

        tasks.append(Task(uid, name, fixed, priority, sd, st, et, d, _type))

    return times, tasks

def validate(times, tasks, to_validate):
    task_dict = {t.uid: t for t in tasks}

    output_uids = {t.uid for t in to_validate}

    for uid in set(task_dict.keys()) - output_uids:
        return False, f"Missing task in output: {task_dict[uid].name}"
    for uid in output_uids - set(task_dict.keys()):
        return False, f"Extra task in output: {uid}"

    output_tasks = []
    for t in to_validate:
        orig = task_dict[t.uid]  
        actual_duration = in_minutes(t.end_time) - in_minutes(t.start_time)
        if actual_duration != t.duration:
            return False, f"Task {t.name} has wrong duration, end_time-start_time is {actual_duration} not {t.duration}"

        output_tasks.append({
            "uid": t.uid,
            "name": t.name,
            "start_date": t.start_date,
            "start_time": t.start_time,
            "end_time": t.end_time,
            "duration": t.duration,
            "fixed": t.fixed,
            "priority": t.priority,
            "type": t._type
        })

    for t in output_tasks:
        orig = task_dict[t["uid"]]
        if t["fixed"]:
            if t["start_date"] != orig.start_date or t["start_time"] != orig.start_time:
                return False, f"Fixed task {t['name']} was moved."

    for t in output_tasks:
        t_type = t["type"]
        start_limit = datetime.strptime(times[t_type]["start"], "%H:%M").time()
        end_limit = datetime.strptime(times[t_type]["end"], "%H:%M").time()
        if in_minutes(t["start_time"]) < in_minutes(start_limit):
            return False, f"{t['name']} starts before allowed {t_type} start time."
        if in_minutes(t["end_time"]) > in_minutes(end_limit):
            return False, f"{t['name']} ends after allowed {t_type} end time."

    output_tasks.sort(key=lambda x: (x["start_date"], x["start_time"]))
    for i in range(len(output_tasks) - 1):
        t1, t2 = output_tasks[i], output_tasks[i + 1]
        if t1["start_date"] != t2["start_date"]:
            continue
        if in_minutes(t1["end_time"]) > in_minutes(t2["start_time"]):
            return False, f"Tasks {t1['name']} and {t2['name']} overlap."

    return True, ""

with open("user_data.json", "r") as f:
    user_json = json.load(f)

if __name__ == "__main__":
    times, tasks = extract_data_from_json(user_json)

    prompt = f"""
    You are a smart scheduling assistant.

    You are given a list of tasks. Some may have missing or incomplete scheduling information.
    Your job is to produce a COMPLETE and VALID schedule by filling in or adjusting task times where allowed.

    Rules:
    - Each task has:
        - uid
        - name (string)
        - fixed (boolean)
        - priority (0–2)
        - start_date ("YYYY-MM-DD")
        - start_time ("HH:MM")
        - end_time ("HH:MM")
        - duration (integer, minutes)
        - type ("personal" | "business" | "school")
    - Fixed tasks cannot have their start date or start time changed.
    - Non-fixed tasks may be rescheduled (date/time/duration) as long as they do not overlap other tasks.
    - All tasks must fit within the following time windows:
    {json.dumps(times, indent=4)}
    - The output must be valid JSON in the structure:
    {{
        "tasks": [
            {{
                "uid": "task_01",
                "name": "...",
                "fixed": true/false,
                "priority": 0–2,
                "start_date": "YYYY-MM-DD",
                "start_time": "HH:MM",
                "end_time": "HH:MM",
                "duration": <minutes>,
                "type": "personal|business|school"
            }}
        ]
    }}

    Here is the current task data (some fields may be missing or flexible):
    {json.dumps([json.loads(t.__str__()) for t in tasks], indent=4)}

    Generate a full schedule JSON following the above rules and ensuring no overlaps or invalid times.
    """

    print("asking")
    print(prompt)
    response = ask(prompt)
    print("received")
    gpt_json = json.loads(response)
    _, gpt_tasks = extract_data_from_json(gpt_json)
    is_valid, message = validate(times, tasks, gpt_tasks)

    max_attempts = 5
    attempt = 0

    while attempt < max_attempts and not is_valid:
        new_prompt = f"""
    The previous schedule you generated was invalid.

    Reason for failure:
    {message}

    Fix the issues while keeping all rules the same.
    Regenerate a full valid schedule JSON that passes all validations.

    Here is the last schedule you produced:
    {json.dumps(gpt_json, indent=4)}
    """
        gpt_json = json.loads(ask(prompt + new_prompt))
        _, gpt_tasks = extract_data_from_json(gpt_json)
        is_valid, message = validate(times, tasks, gpt_tasks)
        attempt += 1

    if is_valid:
        with open("updated_data.json", "w") as f:
            json.dump(gpt_json, f, indent=4)
    else:
        pass
        # print("Failed to produce a valid schedule after several attempts.")

