## Installation and running
Download (and extract) the .git file  
Run npm install in the directory  
Run npm start  
A server will startup and you can trying authorizing your calendar but this will fail as is due to Hasan having to add you as a beta tester due to the program being untrusted by google.  
You can attempt to get your own API keys and Secrets by creating a .env file as such:  
```
GOOGLE_CLIENT_ID=YOUR_ID
GOOGLE_CLIENT_SECRET=YOUR_SECRET
SESSION_SECRET=YOUR_SECRET_2
PORT=3000
OPENAI_API_KEY="key"
```
OPENAI_API_KEY is needed for queries to GPT 5 mini but needs to be paid through your account.  
You can also test the scheduler without messing with Google Calendar by using these files:  
reschedule.py - Actual scheduler prompting the LLM  
demo.py - Prints old schedule and new schedule as ASCII!  
user_data.json - Input JSON for reschedule.py  
updated_data.json - output from reschedule.py and input for demo.py  



## Inspiration

We wanted to build a tool that optimizes your workflow intelligently, using AI to consider several points of view simultaneously necessitating less work from the user. This can combat the challenge of managing increasingly complex workflows.

As people who have experienced stress due to the absurd amount of things we do in our very limited time, we wanted to solve this task using expertise. That motivated ChronoFlow.
## What it does

ChronoFlow analyzes your tasks based around priorities and available time-blocks, using it to automatically schedule optimal time slots for tasks and meetings. It also resolves conflicts in scheduling and promotes both long periods of work and relaxing tasks between. It can connect directly to your Google Calendar and add events in between personalized for your preferences.
How we built it

We chose Node.js for the frontend and Python 3 for the backend. Transferring data between these is done using JSON files. We used GPT-5-mini for cost effectiveness and it also supports taking into consideration the multitude of factors that go behind an optimal schedule

We integrated Google Calendar API to extract your current events and sync it after optimizing Finally, we built a UI/dashboard where users can adjust preferences (work hours, focus sessions, meeting-free blocks) and view their optimized schedule
## Challenges we ran into

Calendar API works inconsistently: We tried using old documentation and updating to new api calls was neither fun or reliable. Merging frontend and backend: JSON output obtained after extracting events was very different from expected backend JSON
## Accomplishments that we're proud of

We built a working prototype where users can see optimized schedules and report fewer context switches and better task-completion rates. We achieved seamless integration with calendar systems (Google) so users don’t have to leave their existing tools.

We incorporated user-preferences (e.g., focus time, no-meeting blocks) that the system respects, making the scheduling feel personalized.
## What we learned

Mastery of every part of the code base is needed to quickly fix errors caused my miscommunication
## What's next for ChronoFlow

Investigate a multi-calendar overlap algorithm: analyse two or more users’ calendar free/busy slots, apply interval-overlap logic (as discussed in a scheduling problem for two persons), then extend it to team-sized groups and embed preference-constraints (e.g., preferred hours, meeting-free zones) so ChronoFlow can suggest optimal common slots automatically.

Prototype task-management tool integrations with platforms like Trello and Asana: leverage existing API/automation frameworks (e.g., two-way-sync integrations already done between Trello and Asana), to feed tasks into ChronoFlow’s scheduling engine and reflect scheduled time-blocks back into the task systems.
Built With

    css
    googlecalendarapi
    gpt-5-mini
    html
    javascript
    json
    node.js

