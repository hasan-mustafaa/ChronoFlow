const express = require('express');
const session = require('express-session');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const { google } = require('googleapis');
const path = require('path');
const fs = require('fs');
const OpenAI = require('openai');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;


app.use(express.static('public'));
app.use(express.json()); 
app.use(session({
    secret: process.env.SESSION_SECRET || 'your-secret-key-change-this-in-production',
    resave: false,
    saveUninitialized: false,
    cookie: { 
        secure: false, 
        httpOnly: true,
        maxAge: 30 * 24 * 60 * 60 * 1000, 
        sameSite: 'lax'
    }
}));

app.use(passport.initialize());
app.use(passport.session());

passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: "http://localhost:3000/auth/google/callback",
    scope: ['profile', 'email', 'https://www.googleapis.com/auth/calendar']
}, (accessToken, refreshToken, profile, done) => {
    profile.accessToken = accessToken;
    profile.refreshToken = refreshToken;
    return done(null, profile);
}));

passport.serializeUser((user, done) => {
    done(null, user);
});

passport.deserializeUser((user, done) => {
    done(null, user);
});


app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/auth/google',
    passport.authenticate('google')
);

app.get('/auth/google/callback',
    passport.authenticate('google', { failureRedirect: '/' }),
    (req, res) => {
        res.redirect('/setup');
    }
);

app.get('/auth/user', (req, res) => {
    if (req.user) {
        const userSafe = {
            id: req.user.id,
            displayName: req.user.displayName,
            emails: req.user.emails,
            photos: req.user.photos
        };
        res.json({ user: userSafe });
    } else {
        res.json({ user: null });
    }
});

app.get('/setup', (req, res) => {
    if (!req.user) {
        return res.redirect('/');
    }
    res.sendFile(path.join(__dirname, 'public', 'setup.html'));
});

app.get('/calendar', (req, res) => {
    if (!req.user) {
        return res.redirect('/');
    }
    res.sendFile(path.join(__dirname, 'public', 'calendar.html'));
});

app.get('/api/calendar', async (req, res) => {
    if (!req.user || !req.user.accessToken) {
        return res.status(401).json({ error: 'Not authenticated' });
    }

    try {
        const oauth2Client = new google.auth.OAuth2(
            process.env.GOOGLE_CLIENT_ID,
            process.env.GOOGLE_CLIENT_SECRET,
            "http://localhost:3000/auth/google/callback"
        );

        oauth2Client.setCredentials({
            access_token: req.user.accessToken,
            refresh_token: req.user.refreshToken
        });

        const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
        
        const now = new Date();
        const timeMax = new Date(now);
        timeMax.setDate(timeMax.getDate() + 7); 
       
        const timeMinDate = new Date(now);
        timeMinDate.setHours(0, 0, 0, 0);

        const timeMaxDate = new Date(timeMax);
        timeMaxDate.setHours(23, 59, 59, 999);
        
        const response = await calendar.events.list({
            calendarId: 'primary',
            timeMin: timeMinDate.toISOString(),
            timeMax: timeMaxDate.toISOString(),
            maxResults: 2500, 
            singleEvents: true,
            orderBy: 'startTime',
        });

        const configuredEvents = loadConfiguredEvents();
        const configuredEventMap = new Map(configuredEvents.map(e => [e.id, e]));
        
        const googleCalendarEventIds = new Set((response.data.items || []).map(e => e.id));

        const googleCalendarTasks = (response.data.items || [])
            .filter(event => !!event.start.dateTime) 
            .map(event => {
                const configured = configuredEventMap.get(event.id);
                const start = event.start.dateTime;
                const end = event.end.dateTime;
                
                const startDate = new Date(start);
                const endDate = new Date(end);
                
                const startHours = String(startDate.getHours()).padStart(2, '0');
                const startMinutes = String(startDate.getMinutes()).padStart(2, '0');
                const start_time = `${startHours}:${startMinutes}`;

                const durationMs = endDate.getTime() - startDate.getTime();
                const durationHours = Math.floor(durationMs / (1000 * 60 * 60));
                const durationMinutes = Math.floor((durationMs % (1000 * 60 * 60)) / (1000 * 60));
                const duration = `${String(durationHours).padStart(2, '0')}:${String(durationMinutes).padStart(2, '0')}`;

                let priorityValue = 'medium'; // Default
                if (configured?.priority !== undefined) {
                    if (typeof configured.priority === 'number') {
                        priorityValue = configured.priority === 0 ? 'low' : configured.priority === 1 ? 'medium' : 'high';
                    } else {
                        priorityValue = configured.priority;
                    }
                }
                
                return {
                    name: configured?.name || event.summary || 'Untitled Event',
                    fixed: configured?.fixed !== undefined ? configured.fixed : false,
                    priority: priorityValue,
                    start_time: start_time,
                    duration: duration,
                    type: configured?.purpose || 'personal', 
                    start_date: `${startDate.getFullYear()}-${String(startDate.getMonth() + 1).padStart(2, '0')}-${String(startDate.getDate()).padStart(2, '0')}`,
                    durationMinutes: Math.floor(durationMs / (1000 * 60)) 
                };
            });

        const manualTasks = configuredEvents
            .filter(event => event.id && event.id.startsWith('manual_') && !googleCalendarEventIds.has(event.id))
            .map(event => {
                let priorityValue = 'medium';
                if (event.priority !== undefined) {
                    if (typeof event.priority === 'number') {
                        priorityValue = event.priority === 0 ? 'low' : event.priority === 1 ? 'medium' : 'high';
                    } else {
                        priorityValue = event.priority;
                    }
                }
                
                let start_time = '';
                let duration = '';
                let durationMinutes = 0;
                let start_date = '';

                if (event.start && event.end && event.start.trim() !== '' && event.end.trim() !== '') {
                    try {
                        const startDate = new Date(event.start);
                        const endDate = new Date(event.end);

                        const startHours = String(startDate.getHours()).padStart(2, '0');
                        const startMinutes = String(startDate.getMinutes()).padStart(2, '0');
                        start_time = `${startHours}:${startMinutes}`;

                        const durationMs = endDate.getTime() - startDate.getTime();
                        const durationHours = Math.floor(durationMs / (1000 * 60 * 60));
                        const durMinutes = Math.floor((durationMs % (1000 * 60 * 60)) / (1000 * 60));
                        duration = `${String(durationHours).padStart(2, '0')}:${String(durMinutes).padStart(2, '0')}`;
                        durationMinutes = Math.floor(durationMs / (1000 * 60));

                        start_date = `${startDate.getFullYear()}-${String(startDate.getMonth() + 1).padStart(2, '0')}-${String(startDate.getDate()).padStart(2, '0')}`;
                    } catch (e) {
                        console.error(`Error parsing dates for manual event "${event.name}":`, e);
                    }
                }
                
                return {
                    name: event.name || 'Untitled Event',
                    fixed: event.fixed !== undefined ? event.fixed : false,
                    priority: priorityValue,
                    start_time: start_time,
                    duration: duration,
                    type: event.purpose || 'personal',
                    start_date: start_date,
                    durationMinutes: durationMinutes,
                    isManual: true 
                };
            });
        const allTasks = [...googleCalendarTasks, ...manualTasks];

        res.json({ tasks: allTasks });
    } catch (error) {
        console.error('Error fetching calendar:', error);
        res.status(500).json({ error: 'Failed to fetch calendar events' });
    }
});

app.get('/api/setup/events', async (req, res) => {
    if (!req.user || !req.user.accessToken) {
        return res.status(401).json({ error: 'Not authenticated' });
    }

        try {
            const timeRange = req.query.range || 'week'; 
            const now = new Date();
            
            const timeMax = new Date(now);
            if (timeRange === 'month') {
                timeMax.setDate(timeMax.getDate() + 30); 
            } else {
                timeMax.setDate(timeMax.getDate() + 7); 
            }
            
            const timeMinDate = new Date(now);
            timeMinDate.setHours(0, 0, 0, 0);
            
            const timeMaxDate = new Date(timeMax);
            timeMaxDate.setHours(23, 59, 59, 999);
            
            console.log(`Fetching events for range: ${timeRange}, from ${timeMinDate.toISOString()} to ${timeMaxDate.toISOString()}`);

        const oauth2Client = new google.auth.OAuth2(
            process.env.GOOGLE_CLIENT_ID,
            process.env.GOOGLE_CLIENT_SECRET,
            "http://localhost:3000/auth/google/callback"
        );

        oauth2Client.setCredentials({
            access_token: req.user.accessToken,
            refresh_token: req.user.refreshToken
        });

        const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
        
        const response = await calendar.events.list({
            calendarId: 'primary',
            timeMin: timeMinDate.toISOString(),
            timeMax: timeMaxDate.toISOString(),
            maxResults: 2500, 
            singleEvents: true,
            orderBy: 'startTime',
        });

        const configuredEvents = loadConfiguredEvents();
        const configuredEventMap = new Map(configuredEvents.map(e => [e.id, e]));
        const configuredEventIds = new Set(configuredEvents.map(e => e.id));
        
        console.log(`Total events from Google Calendar: ${response.data.items?.length || 0}`);
        console.log(`Already configured events: ${configuredEventIds.size}`);

        const newEvents = (response.data.items || [])
            .filter(event => {
                const hasDateTime = !!event.start.dateTime;
                if (!hasDateTime) return false;
                const eventStart = new Date(event.start.dateTime);
                const isWithinRange = eventStart >= timeMinDate && eventStart <= timeMaxDate;
                
                if (!isWithinRange) {
                    console.log(`Event "${event.summary}" (${event.id}) outside range: ${eventStart.toISOString()} (range: ${timeMinDate.toISOString()} to ${timeMaxDate.toISOString()})`);
                    return false;
                }
                
                const notConfigured = !configuredEventIds.has(event.id);
                if (!notConfigured) {
                    console.log(`Excluding configured event: "${event.summary}" (${event.id})`);
                }
                return notConfigured;
            })
            .map(event => {
                const start = event.start.dateTime;
                const end = event.end.dateTime;
                
                const previouslyConfigured = configuredEventMap.get(event.id);
                
                return {
                    id: event.id,
                    name: event.summary || 'Untitled Event',
                    start: start,
                    end: end,
                    priority: previouslyConfigured?.priority || 'medium',
                    purpose: previouslyConfigured?.purpose || 'personal', 
                    fixed: previouslyConfigured?.fixed !== undefined ? previouslyConfigured.fixed : false
                };
            });

        console.log(`Returning ${newEvents.length} events for ${timeRange} view`);
        res.json({ events: newEvents });
    } catch (error) {
        console.error('Error fetching setup events:', error);
        res.status(500).json({ error: 'Failed to fetch events' });
    }
});

app.get('/api/setup/time-ranges', (req, res) => {
    if (!req.user) {
        return res.status(401).json({ error: 'Not authenticated' });
    }

    try {
        const filePath = path.join(__dirname, 'user_data.json');
        let timeRanges = null;
        
        if (fs.existsSync(filePath)) {
            try {
                const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
                timeRanges = data.timeRanges || null;
            } catch (err) {
                console.error('Error reading user_data.json:', err);
            }
        }

        if (!timeRanges) {
            timeRanges = {
                personal: { start: '09:00', end: '17:00' },
                business: { start: '09:00', end: '17:00' },
                school: { start: '09:00', end: '17:00' }
            };
        }

        res.json({ timeRanges });
    } catch (error) {
        console.error('Error fetching time ranges:', error);
        res.status(500).json({ error: 'Failed to fetch time ranges' });
    }
});

app.post('/api/setup/save', async (req, res) => {
    if (!req.user || !req.user.accessToken) {
        return res.status(401).json({ error: 'Not authenticated' });
    }

    try {
        const { events, timeRanges } = req.body;
        if (!events || !Array.isArray(events)) {
            return res.status(400).json({ error: 'Invalid events data' });
        }

        const filePath = path.join(__dirname, 'user_data.json');
        let existingData = {};
        if (fs.existsSync(filePath)) {
            try {
                existingData = JSON.parse(fs.readFileSync(filePath, 'utf8'));
            } catch (err) {
                console.error('Error reading existing user_data.json:', err);
                existingData = {};
            }
        }

        const configuredEvents = loadConfiguredEvents();
        const configuredEventMap = new Map(configuredEvents.map(e => [e.id, e]));

        events.forEach(event => {
            configuredEventMap.set(event.id, {
                id: event.id,
                name: event.name,
                start: event.start,
                end: event.end,
                priority: event.priority,
                purpose: event.purpose,
                fixed: event.fixed
            });
        });

        const configuredEventsArray = Array.from(configuredEventMap.values());
        
        const dataToStore = {
            configuredEvents: configuredEventsArray, 
            timeRanges: timeRanges || existingData.timeRanges || null, 
            tasks: configuredEventsArray.map(event => {
                const startDate = new Date(event.start);
                const endDate = new Date(event.end);

                const startYear = startDate.getFullYear();
                const startMonth = String(startDate.getMonth() + 1).padStart(2, '0');
                const startDay = String(startDate.getDate()).padStart(2, '0');
                const start_date = `${startYear}-${startMonth}-${startDay}`;
                
                const startHours = String(startDate.getHours()).padStart(2, '0');
                const startMinutes = String(startDate.getMinutes()).padStart(2, '0');
                const start_time = `${startHours}:${startMinutes}`;
                
                const durationMs = endDate.getTime() - startDate.getTime();
                const durationHours = Math.floor(durationMs / (1000 * 60 * 60));
                const durationMinutes = Math.floor((durationMs % (1000 * 60 * 60)) / (1000 * 60));
                const duration = `${String(durationHours).padStart(2, '0')}:${String(durationMinutes).padStart(2, '0')}`;
               
                let priorityValue = event.priority;
                if (typeof priorityValue === 'number') {
                    priorityValue = priorityValue === 0 ? 'low' : priorityValue === 1 ? 'medium' : 'high';
                } else if (!priorityValue) {
                    priorityValue = 'medium'; // Default
                }
                
                return {
                    name: event.name,
                    fixed: event.fixed,
                    priority: priorityValue,
                    start_date: start_date,
                    start_time: start_time,
                    duration: duration,
                    type: event.purpose || 'personal' 
                };
            })
        };

        fs.writeFileSync(filePath, JSON.stringify(dataToStore, null, '\t'), 'utf8');
        console.log(`Event configurations saved to ${filePath}`);

        res.json({ success: true });
    } catch (error) {
        console.error('Error saving configurations:', error);
        res.status(500).json({ error: 'Failed to save configurations' });
    }
});

app.get('/add-events', (req, res) => {
    if (!req.user) {
        return res.redirect('/');
    }
    res.sendFile(path.join(__dirname, 'public', 'add-events.html'));
});

async function scheduleEventsWithAI(events) {
    const openai = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY
    });

    const scheduledEvents = events.filter(e => e.start && e.end && e.start !== '' && e.end !== '');
    const unscheduledEvents = events.filter(e => !e.start || !e.end || e.start === '' || e.end === '');

    if (unscheduledEvents.length === 0) {
        console.log('No events to schedule');
        return events;
    }

    console.log(`Scheduling ${unscheduledEvents.length} events using ChatGPT...`);

    const existingEventsInfo = scheduledEvents.map(e => ({
        name: e.name,
        start: e.start,
        end: e.end,
        duration: e.duration || '00:30'
    }));

    const eventsToSchedule = unscheduledEvents.map(e => ({
        name: e.name,
        priority: e.priority || 'medium',
        purpose: e.purpose || 'personal',
        duration: e.duration || '01:00',
        fixed: e.fixed || false,
        weekdaysOnly: e.weekdaysOnly !== false 
    }));

    const prompt = `You are a smart scheduling assistant. Schedule the following events optimally:

**Already Scheduled Events** (cannot be moved or overlapped):
${JSON.stringify(existingEventsInfo, null, 2)}

**Events to Schedule**:
${JSON.stringify(eventsToSchedule, null, 2)}

**Rules:**
1. Start from today: ${new Date().toISOString().split('T')[0]}
2. NO overlaps - events cannot overlap with each other or existing events
3. For each event, start_time + duration must not clash with any other event's time slot
4. Timezone: America/New_York (EST/EDT)
5. Higher priority events should get better time slots
6. Events must fit within reasonable hours (08:00-21:00 for personal, 08:00-17:00 for business, 08:30-17:30 for school)
7. Fixed events already have times set - don't reschedule them
8. If weekdaysOnly is true, schedule events ONLY on weekdays (Monday-Friday), not on weekends (Saturday-Sunday)
9. PRIORITY BIAS: For all events, prioritize scheduling between 10:00 AM - 7:00 PM (10:00-19:00) on weekdays. Higher priority events should get slots within this preferred window. Lower priority events can be scheduled outside this window if necessary, but still respect the weekdaysOnly constraint.
10. Maintain at least 15 minutes buffer between events to prevent conflicts

Return JSON only (no markdown, no explanations):
{
  "scheduled": [
    { "name": "Event Name", "start": "2025-11-03T09:00:00-05:00", "end": "2025-11-03T10:00:00-05:00" }
  ]
}`;

    try {
        const completion = await openai.chat.completions.create({
            model: "gpt-5-mini",
            messages: [
                { role: "system", content: "You return only valid JSON without any markdown formatting." },
                { role: "user", content: prompt }
            ]
        });

        let jsonText = completion.choices[0].message.content.trim();
        jsonText = jsonText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        
        const result = JSON.parse(jsonText);
        const aiScheduled = result.scheduled || [];

        console.log(`AI scheduled ${aiScheduled.length} events`);

        const eventMap = new Map(unscheduledEvents.map(e => [e.name, e]));
        aiScheduled.forEach(aiEvent => {
            const original = eventMap.get(aiEvent.name);
            if (original) {
                console.log(`AI scheduled "${aiEvent.name}": start=${aiEvent.start}, end=${aiEvent.end}`);
                original.start = aiEvent.start;
                
                if (aiEvent.start && original.duration) {
                    const startDate = new Date(aiEvent.start);
                    const [hours, minutes] = original.duration.split(':').map(Number);
                    const endDate = new Date(startDate.getTime() + (hours * 60 + minutes) * 60 * 1000);
                    
                    const tzMatch = aiEvent.start.match(/([+-]\d{2}:\d{2})$/);
                    if (tzMatch) {
                        const timezone = tzMatch[1];
                        const startParts = aiEvent.start.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})/);
                        if (startParts) {
                            const startHour = parseInt(startParts[2]);
                            const startMin = parseInt(startParts[3]);
                            const startSec = parseInt(startParts[4]);
                            
                            let endHour = startHour + hours;
                            let endMin = startMin + minutes;
                            let endSec = startSec;
                            let endDay = parseInt(startParts[1].substring(8, 10));
                            let endMonth = parseInt(startParts[1].substring(5, 7));
                            let endYear = parseInt(startParts[1].substring(0, 4));
                            
                            if (endMin >= 60) {
                                endHour += Math.floor(endMin / 60);
                                endMin = endMin % 60;
                            }
                            if (endHour >= 24) {
                                endDay += Math.floor(endHour / 24);
                                endHour = endHour % 24;
                            }
                            
                            original.end = `${endYear}-${String(endMonth).padStart(2, '0')}-${String(endDay).padStart(2, '0')}T${String(endHour).padStart(2, '0')}:${String(endMin).padStart(2, '0')}:${String(endSec).padStart(2, '0')}${timezone}`;
                        } else {
                            original.end = endDate.toISOString();
                        }
                    } else {
                        // Use ISO string if no timezone in start
                        original.end = endDate.toISOString();
                    }
                    console.log(`Calculated end time for "${aiEvent.name}": ${original.end} (duration: ${original.duration})`);
                } else {
                    original.end = aiEvent.end;
                    console.log(`Using AI-provided end time for "${aiEvent.name}": ${original.end}`);
                }
            } else {
                console.warn(`Could not find original event for "${aiEvent.name}"`);
            }
        });

        // Validate no clashes
        const allEvents = [...scheduledEvents, ...unscheduledEvents];
        const clashes = [];
        
        for (let i = 0; i < allEvents.length; i++) {
            for (let j = i + 1; j < allEvents.length; j++) {
                const e1 = allEvents[i];
                const e2 = allEvents[j];
                
                if (e1.start && e1.end && e2.start && e2.end) {
                    const start1 = new Date(e1.start);
                    const end1 = new Date(e1.end);
                    const start2 = new Date(e2.start);
                    const end2 = new Date(e2.end);
                    
                    // Check if events overlap
                    if (start1 < end2 && start2 < end1) {
                        clashes.push(`${e1.name} and ${e2.name}`);
                    }
                }
            }
        }

        if (clashes.length > 0) {
            console.warn(`Warning: Found ${clashes.length} potential clashes: ${clashes.join(', ')}`);
        } else {
            console.log('No clashes detected');
        }

        return allEvents;
    } catch (error) {
        console.error('AI scheduling error:', error.message);
        // Return events as-is if AI scheduling fails
        return events;
    }
}

// Helper function to sync manually added events to Google Calendar
async function syncEventsToGoogleCalendar(events, userAccessToken, userRefreshToken) {
    try {
        // Filter for manually added events that have been scheduled
        console.log(`Checking ${events.length} events for sync...`);
        const manualEvents = events.filter(event => {
            const isManual = event.id && event.id.startsWith('manual_');
            const hasTimes = event.start && event.end && event.start !== '' && event.end !== '';
            if (isManual) {
                console.log(`  Event "${event.name}": id=${event.id}, start=${event.start}, end=${event.end}, hasTimes=${hasTimes}`);
            }
            return isManual && hasTimes;
        });

        if (manualEvents.length === 0) {
            console.log('No scheduled manual events to sync');
            const manualButNoTimes = events.filter(e => e.id && e.id.startsWith('manual_'));
            if (manualButNoTimes.length > 0) {
                console.log(`Found ${manualButNoTimes.length} manual events but they lack start/end times:`);
                manualButNoTimes.forEach(e => {
                    console.log(`  - "${e.name}": start=${e.start}, end=${e.end}`);
                });
            }
            return { created: 0, skipped: 0, errors: [] };
        }

        console.log(`Syncing ${manualEvents.length} events to Google Calendar...`);

        // Set up Google Calendar API client
        const oauth2Client = new google.auth.OAuth2(
            process.env.GOOGLE_CLIENT_ID,
            process.env.GOOGLE_CLIENT_SECRET,
            "http://localhost:3000/auth/google/callback"
        );

        oauth2Client.setCredentials({
            access_token: userAccessToken,
            refresh_token: userRefreshToken
        });

        const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

        // Get existing events to check for duplicates
        const now = new Date();
        const timeMinDate = new Date(now);
        timeMinDate.setDate(timeMinDate.getDate() - 1); // Check from yesterday
        const timeMaxDate = new Date(now);
        timeMaxDate.setDate(timeMaxDate.getDate() + 30); // Check next 30 days

        let existingEvents = [];
        try {
            const existingResponse = await calendar.events.list({
                calendarId: 'primary',
                timeMin: timeMinDate.toISOString(),
                timeMax: timeMaxDate.toISOString(),
                maxResults: 2500,
                singleEvents: true,
                orderBy: 'startTime',
            });
            existingEvents = existingResponse.data.items || [];
        } catch (err) {
            console.warn('Could not fetch existing events for duplicate check:', err.message);
        }

        const results = {
            created: 0,
            skipped: 0,
            errors: []
        };

        for (const event of manualEvents) {
            try {
                console.log(`Processing event for sync: "${event.name}", start: ${event.start}, end: ${event.end}`);
                
                // Check for duplicates by name and start time (within 1 minute tolerance)
                const eventStartTime = new Date(event.start);
                const isDuplicate = existingEvents.some(existing => {
                    if (!existing.start.dateTime) return false;
                    const existingStartTime = new Date(existing.start.dateTime);
                    const timeDiff = Math.abs(eventStartTime.getTime() - existingStartTime.getTime());
                    return existing.summary === event.name && timeDiff < 60000; // 1 minute tolerance
                });

                if (isDuplicate) {
                    console.log(`Skipping duplicate event: "${event.name}" at ${eventStartTime.toISOString()}`);
                    results.skipped++;
                    continue;
                }
                
                console.log(`Creating event "${event.name}" in Google Calendar...`);

                // Create Google Calendar event object
                const timezone = 'America/New_York';
                let startDateTime = event.start;
                let endDateTime = event.end;
                
                // Helper function to format datetime in ET timezone (for Google Calendar API with timeZone specified)
                // When dateStr has timezone offset like "-05:00", extract the ET time directly
                // When dateStr is UTC (ends with Z), convert to ET
                const formatInET = (dateStr) => {
                    // If it already has timezone offset, extract the datetime part
                    if (dateStr.includes('-05:00') || dateStr.includes('-04:00') || (dateStr.includes('+') && !dateStr.endsWith('Z'))) {
                        // Extract the datetime part before the timezone
                        const tzMatch = dateStr.match(/^(.+?)([+-]\d{2}:\d{2})$/);
                        if (tzMatch) {
                            return tzMatch[1].replace(/\.\d{3}/, ''); // Remove milliseconds if present
                        }
                    }
                    // If UTC (ends with Z), convert to ET
                    if (dateStr.endsWith('Z')) {
                        const date = new Date(dateStr);
                        const etOffsetHours = -5; // EST offset
                        const etDate = new Date(date.getTime() + (etOffsetHours * 60 * 60 * 1000));
                        const year = etDate.getUTCFullYear();
                        const month = String(etDate.getUTCMonth() + 1).padStart(2, '0');
                        const day = String(etDate.getUTCDate()).padStart(2, '0');
                        const hours = String(etDate.getUTCHours()).padStart(2, '0');
                        const minutes = String(etDate.getUTCMinutes()).padStart(2, '0');
                        const seconds = String(etDate.getUTCSeconds()).padStart(2, '0');
                        return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}`;
                    }
                    // Fallback: parse and format
                    const date = new Date(dateStr);
                    const year = date.getFullYear();
                    const month = String(date.getMonth() + 1).padStart(2, '0');
                    const day = String(date.getDate()).padStart(2, '0');
                    const hours = String(date.getHours()).padStart(2, '0');
                    const minutes = String(date.getMinutes()).padStart(2, '0');
                    const seconds = String(date.getSeconds()).padStart(2, '0');
                    return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}`;
                };
                
                // Handle UTC timestamps (ending with Z) - convert to ET
                if (event.start.endsWith('Z')) {
                    const utcDate = new Date(event.start);
                    const utcEndDate = new Date(event.end);
                    const etOffsetHours = -5; // EST offset
                    
                    const formatET = (utcDate) => {
                        const etDate = new Date(utcDate.getTime() + (etOffsetHours * 60 * 60 * 1000));
                        const year = etDate.getUTCFullYear();
                        const month = String(etDate.getUTCMonth() + 1).padStart(2, '0');
                        const day = String(etDate.getUTCDate()).padStart(2, '0');
                        const hours = String(etDate.getUTCHours()).padStart(2, '0');
                        const minutes = String(etDate.getUTCMinutes()).padStart(2, '0');
                        const seconds = String(etDate.getUTCSeconds()).padStart(2, '0');
                        return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}`;
                    };
                    
                    startDateTime = formatET(utcDate);
                    endDateTime = formatET(utcEndDate);
                } else if (event.start.includes('+') || (event.start.includes('-') && !event.start.endsWith('Z'))) {
                    // Start has timezone offset, convert to ET format
                    startDateTime = formatInET(event.start);
                    // Handle end time - might be UTC (Z) or have timezone
                    if (event.end.endsWith('Z')) {
                        // End is UTC, convert to ET
                        endDateTime = formatInET(event.end);
                    } else {
                        // End has timezone or is local, convert to ET
                        endDateTime = formatInET(event.end);
                    }
                } else {
                    startDateTime = formatInET(event.start);
                    endDateTime = formatInET(event.end);
                }
                
                const calendarEvent = {
                    summary: event.name || 'Untitled Event',
                    start: {
                        dateTime: startDateTime,
                        timeZone: timezone
                    },
                    end: {
                        dateTime: endDateTime,
                        timeZone: timezone
                    },
                    description: `Priority: ${event.priority || ''}, Purpose: ${event.purpose || ''}, Fixed: ${event.fixed || false}`
                };

                const response = await calendar.events.insert({
                    calendarId: 'primary',
                    resource: calendarEvent
                });

                console.log(`Created event in Google Calendar: "${event.name}" (ID: ${response.data.id})`);
                results.created++;

            } catch (error) {
                console.error(`Error creating event "${event.name}":`, error.message);
                console.error(`   Error details:`, JSON.stringify(error, null, 2));
                results.errors.push({
                    event: event.name,
                    error: error.message
                });
            }
        }

        console.log(` Synced ${results.created} events to Google Calendar (skipped: ${results.skipped}, errors: ${results.errors.length})`);
        return results;
    } catch (error) {
        console.error('Error syncing to Google Calendar:', error.message);
        console.error('Full error:', error);
        return { created: 0, skipped: 0, errors: [{ error: error.message }] };
    }
}

// API endpoint to save manually added events
app.post('/api/add-events/save', async (req, res) => {
    if (!req.user || !req.user.accessToken) {
        return res.status(401).json({ error: 'Not authenticated' });
    }

    try {
        const { events } = req.body;
        if (!events || !Array.isArray(events)) {
            return res.status(400).json({ error: 'Invalid events data' });
        }

        // Fetch events from Google Calendar - completely ignoring any existing user_data.json
        const oauth2Client = new google.auth.OAuth2(
            process.env.GOOGLE_CLIENT_ID,
            process.env.GOOGLE_CLIENT_SECRET,
            "http://localhost:3000/auth/google/callback"
        );

        oauth2Client.setCredentials({
            access_token: req.user.accessToken,
            refresh_token: req.user.refreshToken
        });

        const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

        // Get events for the next 30 days from today
        const now = new Date();
        const timeMinDate = new Date(now);
        timeMinDate.setHours(0, 0, 0, 0);
        
        const timeMaxDate = new Date(now);
        timeMaxDate.setDate(timeMaxDate.getDate() + 30);
        timeMaxDate.setHours(23, 59, 59, 999);

        const response = await calendar.events.list({
            calendarId: 'primary',
            timeMin: timeMinDate.toISOString(),
            timeMax: timeMaxDate.toISOString(),
            maxResults: 2500,
            singleEvents: true,
            orderBy: 'startTime',
        });

        const configuredEvents = [];
        const tasks = [];

        (response.data.items || []).forEach(event => {
            if (!event.start.dateTime) return;

            const start = event.start.dateTime;
            const end = event.end.dateTime;
            const startDate = new Date(start);
            const endDate = new Date(end);

            const durationMs = endDate.getTime() - startDate.getTime();
            const durationHours = Math.floor(durationMs / (1000 * 60 * 60));
            const durationMinutes = Math.floor((durationMs % (1000 * 60 * 60)) / (1000 * 60));
            const duration = `${String(durationHours).padStart(2, '0')}:${String(durationMinutes).padStart(2, '0')}`;

            configuredEvents.push({
                id: event.id,
                name: event.summary || 'Untitled Event',
                start: start,
                end: end,
                duration: duration,
                priority: 'medium',
                purpose: 'personal',
                fixed: false
            });

            const startYear = startDate.getFullYear();
            const startMonth = String(startDate.getMonth() + 1).padStart(2, '0');
            const startDay = String(startDate.getDate()).padStart(2, '0');
            const start_date = `${startYear}-${startMonth}-${startDay}`;

            const startHours = String(startDate.getHours()).padStart(2, '0');
            const startMinutes = String(startDate.getMinutes()).padStart(2, '0');
            const start_time = `${startHours}:${startMinutes}`;

            tasks.push({
                name: event.summary || 'Untitled Event',
                fixed: false,
                priority: 'medium',
                start_date: start_date,
                start_time: start_time,
                duration: duration,
                type: 'personal'
            });
        });

        const newEventsFilePath = path.join(__dirname, 'new_events.json');
        let newEventsFromFile = [];
        if (fs.existsSync(newEventsFilePath)) {
            try {
                const fileContent = fs.readFileSync(newEventsFilePath, 'utf8');
                newEventsFromFile = JSON.parse(fileContent);
                if (!Array.isArray(newEventsFromFile)) {
                    newEventsFromFile = [];
                }
                console.log(`📄 Read ${newEventsFromFile.length} events from new_events.json`);
            } catch (err) {
                console.error('Error reading new_events.json:', err);
                newEventsFromFile = [];
            }
        }

        const allNewEvents = [...newEventsFromFile, ...events];

        allNewEvents.forEach((event, index) => {
            const eventId = `manual_${Date.now()}_${index}_${Math.random().toString(36).substr(2, 9)}`;
            
            let startISO = '';
            let endISO = '';
            let startDate = '';
            let startTime = '';
            let duration = '';
            const name = (event.name !== undefined && event.name !== null) ? String(event.name) : '';
            const priority = (event.priority !== undefined && event.priority !== null) ? String(event.priority) : '';
            const purpose = (event.purpose !== undefined && event.purpose !== null) ? String(event.purpose) : '';
            const fixed = (event.fixed !== undefined && event.fixed !== null) ? Boolean(event.fixed) : false;
            const weekdaysOnly = (event.weekdaysOnly !== undefined && event.weekdaysOnly !== null) ? Boolean(event.weekdaysOnly) : true; // Default to true
            
            if (fixed && event.date && event.startTime && event.durationHours !== undefined && event.durationMinutes !== undefined) {
                const startDateTime = new Date(`${event.date}T${event.startTime}`);
               
                const durationHours = parseInt(event.durationHours) || 0;
                const durationMinutes = parseInt(event.durationMinutes) || 0;
                const endDateTime = new Date(startDateTime);
                endDateTime.setHours(endDateTime.getHours() + durationHours);
                endDateTime.setMinutes(endDateTime.getMinutes() + durationMinutes);
                
                startISO = startDateTime.toISOString();
                endISO = endDateTime.toISOString();
                
                const startYear = startDateTime.getFullYear();
                const startMonth = String(startDateTime.getMonth() + 1).padStart(2, '0');
                const startDay = String(startDateTime.getDate()).padStart(2, '0');
                startDate = `${startYear}-${startMonth}-${startDay}`;
                
                const startHours = String(startDateTime.getHours()).padStart(2, '0');
                const startMinutes = String(startDateTime.getMinutes()).padStart(2, '0');
                startTime = `${startHours}:${startMinutes}`;
                
                duration = `${String(durationHours).padStart(2, '0')}:${String(durationMinutes).padStart(2, '0')}`;
            } else if (!fixed && event.durationHours !== undefined && event.durationMinutes !== undefined) {
                
                const durationHours = parseInt(event.durationHours) || 0;
                const durationMinutes = parseInt(event.durationMinutes) || 0;
                duration = `${String(durationHours).padStart(2, '0')}:${String(durationMinutes).padStart(2, '0')}`;
            }
            
            
            configuredEvents.push({
                id: eventId,
                name: name,
                start: startISO,
                end: endISO, 
                duration: duration, 
                priority: priority,
                purpose: purpose,
                fixed: fixed,
                weekdaysOnly: weekdaysOnly
            });
            
            tasks.push({
                name: name,
                fixed: fixed,
                priority: priority,
                start_date: startDate,
                start_time: startTime,
                duration: duration,
                type: purpose
            });
            
            console.log(`Added new event: ${name || '(no name)'} - priority: ${priority || '(empty)'}, purpose: ${purpose || '(empty)'}, fixed: ${fixed}`);
        });

        const scheduledEvents = await scheduleEventsWithAI(configuredEvents);

        const updatedTasks = scheduledEvents.map(event => {

            const matchingTask = tasks.find(t => t.name === event.name);
            
            if (event.start && event.end && event.start !== '' && event.end !== '') {
                const startDate = new Date(event.start);
                const endDate = new Date(event.end);
                
                const startYear = startDate.getFullYear();
                const startMonth = String(startDate.getMonth() + 1).padStart(2, '0');
                const startDay = String(startDate.getDate()).padStart(2, '0');
                const start_date = `${startYear}-${startMonth}-${startDay}`;
                
                const startHours = String(startDate.getHours()).padStart(2, '0');
                const startMinutes = String(startDate.getMinutes()).padStart(2, '0');
                const start_time = `${startHours}:${startMinutes}`;
                
                return {
                    name: event.name,
                    fixed: event.fixed || false,
                    priority: matchingTask?.priority || event.priority || 'medium',
                    start_date: start_date,
                    start_time: start_time,
                    duration: event.duration || matchingTask?.duration || '01:00',
                    type: event.purpose || matchingTask?.type || 'personal'
                };
            } else {
                return matchingTask || {
                    name: event.name,
                    fixed: event.fixed || false,
                    priority: event.priority || 'medium',
                    start_date: '',
                    start_time: '',
                    duration: event.duration || '01:00',
                    type: event.purpose || 'personal'
                };
            }
        });

        const filePath = path.join(__dirname, 'user_data.json');
        const newData = {
            configuredEvents: scheduledEvents,
            tasks: updatedTasks,
            timeRanges: null
        };

        fs.writeFileSync(filePath, JSON.stringify(newData, null, '\t'), 'utf8');
        console.log(`Created fresh user_data.json with ${scheduledEvents.length} events:`);
        console.log(`  - ${(response.data.items || []).filter(e => e.start?.dateTime).length} from Google Calendar`);
        console.log(`  - ${newEventsFromFile.length} from new_events.json`);
        console.log(`  - ${events.length} from request body`);
        console.log(`  - ${allNewEvents.length} total new events processed`);
        console.log(`Saved to: ${filePath}`);
        
        if (fs.existsSync(filePath)) {
            const savedData = JSON.parse(fs.readFileSync(filePath, 'utf8'));
            console.log(`Verification: user_data.json contains ${savedData.configuredEvents?.length || 0} configuredEvents and ${savedData.tasks?.length || 0} tasks`);
        }

        const updatedDataPath = path.join(__dirname, 'updated_data.json');
        try {
            fs.copyFileSync(filePath, updatedDataPath);
            console.log(`Created/updated updated_data.json from user_data.json`);
           
            if (fs.existsSync(updatedDataPath)) {
                const updatedData = JSON.parse(fs.readFileSync(updatedDataPath, 'utf8'));
                const updatedStats = fs.statSync(updatedDataPath);
                console.log(`Verification: updated_data.json contains ${updatedData.configuredEvents?.length || 0} configuredEvents and ${updatedData.tasks?.length || 0} tasks`);
                console.log(`updated_data.json file size: ${updatedStats.size} bytes`);
                
                const newEventNames = allNewEvents.map(e => e.name || '').filter(n => n);
                if (newEventNames.length > 0) {
                    const foundInUpdated = newEventNames.filter(name => 
                        updatedData.tasks?.some(t => t.name === name) || 
                        updatedData.configuredEvents?.some(c => c.name === name)
                    );
                    console.log(`New events in updated_data.json: ${foundInUpdated.length}/${newEventNames.length}`);
                    if (foundInUpdated.length < newEventNames.length) {
                        const missing = newEventNames.filter(n => !foundInUpdated.includes(n));
                        console.error(`Missing events in updated_data.json: ${missing.join(', ')}`);
                    }
                }
            }
        } catch (copyError) {
            console.error(`Error copying to updated_data.json:`, copyError);
        }
        console.log(`About to sync ${scheduledEvents.length} scheduled events...`);
        const manualScheduled = scheduledEvents.filter(e => e.id && e.id.startsWith('manual_'));
        console.log(`Found ${manualScheduled.length} manual events in scheduledEvents:`);
        manualScheduled.forEach(e => {
            console.log(`  - "${e.name}": id=${e.id}, start=${e.start}, end=${e.end}, duration=${e.duration}`);
        });
        
        const syncResults = await syncEventsToGoogleCalendar(
            scheduledEvents,
            req.user.accessToken,
            req.user.refreshToken
        );

        if (syncResults.created > 0) {
            console.log(`Successfully synced ${syncResults.created} events to Google Calendar`);
        }
        if (syncResults.errors.length > 0) {
            console.warn(`Some events failed to sync: ${syncResults.errors.length} errors`);
        }

        res.json({ 
            success: true,
            synced: syncResults.created,
            syncErrors: syncResults.errors.length
        });
    } catch (error) {
        console.error('Error saving new events:', error);
        res.status(500).json({ error: 'Failed to save events' });
    }
});

app.post('/api/calendar/sync', async (req, res) => {
    if (!req.user || !req.user.accessToken) {
        return res.status(401).json({ error: 'Not authenticated' });
    }

    try {
        const updatedDataPath = path.join(__dirname, 'updated_data.json');
        if (!fs.existsSync(updatedDataPath)) {
            return res.status(404).json({ error: 'updated_data.json not found' });
        }

        const updatedData = JSON.parse(fs.readFileSync(updatedDataPath, 'utf8'));
        const configuredEvents = updatedData.configuredEvents || [];

        const manualEvents = configuredEvents.filter(event => event.id && event.id.startsWith('manual_'));

        if (manualEvents.length === 0) {
            return res.json({ 
                success: true, 
                message: 'No new manual events to sync',
                created: 0,
                skipped: 0
            });
        }

        const oauth2Client = new google.auth.OAuth2(
            process.env.GOOGLE_CLIENT_ID,
            process.env.GOOGLE_CLIENT_SECRET,
            "http://localhost:3000/auth/google/callback"
        );

        oauth2Client.setCredentials({
            access_token: req.user.accessToken,
            refresh_token: req.user.refreshToken
        });

        const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

        const results = {
            created: 0,
            skipped: 0,
            errors: [],
            createdEventIds: [] 
        };

        for (const event of manualEvents) {
            try {
                if (!event.start || !event.end || event.start === '' || event.end === '') {
                    console.log(`⏭️ Skipping event "${event.name}" - no date/time specified`);
                    results.skipped++;
                    continue;
                }

                let startDateTime = event.start;
                let endDateTime = event.end;
                const timezone = 'America/New_York'; 
                
                if (event.start.endsWith('Z')) {
                    const utcDate = new Date(event.start);
                    const utcEndDate = new Date(event.end);
                    
                    const etOffsetHours = -5; 
                    
                    const formatET = (utcDate) => {
                        const etDate = new Date(utcDate.getTime() + (etOffsetHours * 60 * 60 * 1000));
                        const year = etDate.getUTCFullYear();
                        const month = String(etDate.getUTCMonth() + 1).padStart(2, '0');
                        const day = String(etDate.getUTCDate()).padStart(2, '0');
                        const hours = String(etDate.getUTCHours()).padStart(2, '0');
                        const minutes = String(etDate.getUTCMinutes()).padStart(2, '0');
                        const seconds = String(etDate.getUTCSeconds()).padStart(2, '0');
                        return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}`;
                    };
                    
                    startDateTime = formatET(utcDate);
                    endDateTime = formatET(utcEndDate);
                } else if (event.start.includes('+') || event.start.includes('-')) {
                    startDateTime = event.start.split(/[+-]/)[0];
                    endDateTime = event.end.split(/[+-]/)[0];
                }
                
                const calendarEvent = {
                    summary: event.name || 'Untitled Event',
                    start: {
                        dateTime: startDateTime,
                        timeZone: timezone
                    },
                    end: {
                        dateTime: endDateTime,
                        timeZone: timezone
                    },
                    description: `Priority: ${event.priority || ''}, Purpose: ${event.purpose || ''}, Fixed: ${event.fixed || false}`
                };

                const response = await calendar.events.insert({
                    calendarId: 'primary',
                    resource: calendarEvent
                });

                const googleCalendarId = response.data.id;
                console.log(`Created event in Google Calendar: "${event.name}" (ID: ${googleCalendarId})`);
                results.created++;
                results.createdEventIds.push({
                    googleCalendarId: googleCalendarId,
                    eventName: event.name,
                    manualId: event.id
                });

            } catch (error) {
                console.error(`Error creating event "${event.name}":`, error.message);
                results.errors.push({
                    event: event.name,
                    error: error.message
                });
            }
        }

        // Save sync info to a file so we can revert later
        if (results.created > 0) {
            const syncInfoPath = path.join(__dirname, 'sync_info.json');
            const syncInfo = {
                timestamp: new Date().toISOString(),
                createdEventIds: results.createdEventIds
            };
            fs.writeFileSync(syncInfoPath, JSON.stringify(syncInfo, null, '\t'), 'utf8');
            console.log(`Saved sync info to sync_info.json with ${results.createdEventIds.length} event IDs`);
        }

        res.json({
            success: true,
            message: `Synced ${results.created} events to Google Calendar`,
            created: results.created,
            skipped: results.skipped,
            errors: results.errors
        });

    } catch (error) {
        console.error('Error syncing events to Google Calendar:', error);
        res.status(500).json({ error: 'Failed to sync events to Google Calendar' });
    }
});

app.post('/api/calendar/revert', async (req, res) => {
    if (!req.user || !req.user.accessToken) {
        return res.status(401).json({ error: 'Not authenticated' });
    }

    try {
        const syncInfoPath = path.join(__dirname, 'sync_info.json');
        if (!fs.existsSync(syncInfoPath)) {
            return res.status(404).json({ 
                success: false,
                error: 'No sync information found. Nothing to revert.' 
            });
        }

        const syncInfo = JSON.parse(fs.readFileSync(syncInfoPath, 'utf8'));
        const createdEventIds = syncInfo.createdEventIds || [];

        if (createdEventIds.length === 0) {
            return res.json({
                success: true,
                message: 'No events to revert',
                deleted: 0
            });
        }

        const oauth2Client = new google.auth.OAuth2(
            process.env.GOOGLE_CLIENT_ID,
            process.env.GOOGLE_CLIENT_SECRET,
            "http://localhost:3000/auth/google/callback"
        );

        oauth2Client.setCredentials({
            access_token: req.user.accessToken,
            refresh_token: req.user.refreshToken
        });

        const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
        const results = {
            deleted: 0,
            errors: []
        };

        for (const eventInfo of createdEventIds) {
            try {
                await calendar.events.delete({
                    calendarId: 'primary',
                    eventId: eventInfo.googleCalendarId
                });

                console.log(`Deleted event from Google Calendar: "${eventInfo.eventName}" (ID: ${eventInfo.googleCalendarId})`);
                results.deleted++;

            } catch (error) {
                console.error(`Error deleting event "${eventInfo.eventName}":`, error.message);
                results.errors.push({
                    event: eventInfo.eventName,
                    error: error.message
                });
            }
        }
        if (results.deleted > 0) {
            try {
                fs.unlinkSync(syncInfoPath);
                console.log(`Deleted sync_info.json`);
            } catch (err) {
                console.error('Error deleting sync_info.json:', err);
            }
        }

        res.json({
            success: true,
            message: `Reverted ${results.deleted} events from Google Calendar`,
            deleted: results.deleted,
            errors: results.errors
        });

    } catch (error) {
        console.error('Error reverting sync:', error);
        res.status(500).json({ error: 'Failed to revert sync' });
    }
});
app.get('/api/calendar/scopes', async (req, res) => {
    if (!req.user || !req.user.accessToken) {
        return res.status(401).json({ error: 'Not authenticated' });
    }

    try {
        const https = require('https');
        const url = `https://www.googleapis.com/oauth2/v1/tokeninfo?access_token=${req.user.accessToken}`;
        
        const tokenInfo = await new Promise((resolve, reject) => {
            https.get(url, (response) => {
                let data = '';
                response.on('data', (chunk) => { data += chunk; });
                response.on('end', () => {
                    try {
                        resolve(JSON.parse(data));
                    } catch (e) {
                        reject(e);
                    }
                });
            }).on('error', reject);
        });
        
        res.json({
            success: true,
            scopes: tokenInfo.scope ? tokenInfo.scope.split(' ') : [],
            hasCalendarWrite: tokenInfo.scope && tokenInfo.scope.includes('https://www.googleapis.com/auth/calendar'),
            hasCalendarReadonly: tokenInfo.scope && tokenInfo.scope.includes('https://www.googleapis.com/auth/calendar.readonly'),
            error: tokenInfo.error || null
        });
    } catch (error) {
        console.error('Error checking scopes:', error);
        res.status(500).json({ error: 'Failed to check scopes' });
    }
});
app.get('/api/calendar/verify', async (req, res) => {
    if (!req.user || !req.user.accessToken) {
        return res.status(401).json({ error: 'Not authenticated' });
    }

    try {
        const syncInfoPath = path.join(__dirname, 'sync_info.json');
        if (!fs.existsSync(syncInfoPath)) {
            return res.json({
                success: true,
                message: 'No sync information found',
                syncedEvents: []
            });
        }

        const syncInfo = JSON.parse(fs.readFileSync(syncInfoPath, 'utf8'));
        const syncedEventIds = syncInfo.createdEventIds || [];

        if (syncedEventIds.length === 0) {
            return res.json({
                success: true,
                message: 'No synced events to verify',
                syncedEvents: []
            });
        }

        const oauth2Client = new google.auth.OAuth2(
            process.env.GOOGLE_CLIENT_ID,
            process.env.GOOGLE_CLIENT_SECRET,
            "http://localhost:3000/auth/google/callback"
        );

        oauth2Client.setCredentials({
            access_token: req.user.accessToken,
            refresh_token: req.user.refreshToken
        });

        const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

        const verificationResults = [];
        for (const eventInfo of syncedEventIds) {
            try {
                const event = await calendar.events.get({
                    calendarId: 'primary',
                    eventId: eventInfo.googleCalendarId
                });
                verificationResults.push({
                    eventName: eventInfo.eventName,
                    exists: true,
                    googleCalendarId: eventInfo.googleCalendarId,
                    startTime: event.data.start?.dateTime || event.data.start?.date,
                    summary: event.data.summary
                });
            } catch (error) {
                if (error.code === 404) {
                    verificationResults.push({
                        eventName: eventInfo.eventName,
                        exists: false,
                        googleCalendarId: eventInfo.googleCalendarId,
                        error: 'Event not found in Google Calendar'
                    });
                } else {
                    verificationResults.push({
                        eventName: eventInfo.eventName,
                        exists: false,
                        googleCalendarId: eventInfo.googleCalendarId,
                        error: error.message
                    });
                }
            }
        }

        const existingCount = verificationResults.filter(r => r.exists).length;

        res.json({
            success: true,
            message: `Found ${existingCount} of ${syncedEventIds.length} synced events in Google Calendar`,
            totalSynced: syncedEventIds.length,
            existingInCalendar: existingCount,
            verificationResults: verificationResults
        });

    } catch (error) {
        console.error('Error verifying synced events:', error);
        res.status(500).json({ error: 'Failed to verify synced events' });
    }
});

function loadConfiguredEvents() {
    const filePath = path.join(__dirname, 'user_data.json');
    try {
        if (fs.existsSync(filePath)) {
            const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
            return data.configuredEvents || [];
        }
    } catch (error) {
        console.error('Error loading configured events:', error);
    }
    return [];
}

app.get('/auth/logout', (req, res) => {
    req.logout((err) => {
        if (err) {
            return res.redirect('/');
        }
        req.session.destroy(() => {
            res.redirect('/');
        });
    });
});

app.listen(PORT, () => {
    console.log(`http://localhost:${PORT}`);
});