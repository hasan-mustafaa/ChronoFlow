const express = require('express');
const session = require('express-session');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const { google } = require('googleapis');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.static('public'));
app.use(express.json()); // Parse JSON bodies
app.use(session({
    secret: process.env.SESSION_SECRET || 'your-secret-key-change-this-in-production',
    resave: false,
    saveUninitialized: false,
    cookie: { 
        secure: false, // Set to true in production with HTTPS
        httpOnly: true,
        maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
        sameSite: 'lax'
    }
}));

app.use(passport.initialize());
app.use(passport.session());

// Passport configuration
passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: "http://localhost:3000/auth/google/callback",
    scope: ['profile', 'email', 'https://www.googleapis.com/auth/calendar']
}, (accessToken, refreshToken, profile, done) => {
    // Store tokens with the profile
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

// Routes
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/auth/google',
    passport.authenticate('google')
);

app.get('/auth/google/callback',
    passport.authenticate('google', { failureRedirect: '/' }),
    (req, res) => {
        // Successful authentication - redirect to setup page first
        res.redirect('/setup');
    }
);

app.get('/auth/user', (req, res) => {
    if (req.user) {
        // Don't send tokens to client for security
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

// Setup page route
app.get('/setup', (req, res) => {
    if (!req.user) {
        return res.redirect('/');
    }
    res.sendFile(path.join(__dirname, 'public', 'setup.html'));
});

// Calendar page route
app.get('/calendar', (req, res) => {
    if (!req.user) {
        return res.redirect('/');
    }
    res.sendFile(path.join(__dirname, 'public', 'calendar.html'));
});

// API endpoint to get calendar events
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
        
        // Default to week view for calendar page (can be made configurable later)
        // Use current time in UTC for consistent date calculations
        const now = new Date();
        const timeMax = new Date(now);
        timeMax.setDate(timeMax.getDate() + 7); // Next 7 days from today
        
        // Set time to start of day (00:00:00) for timeMin to include all events today
        const timeMinDate = new Date(now);
        timeMinDate.setHours(0, 0, 0, 0);
        
        // Set timeMax to end of day (23:59:59) on the 7th day
        const timeMaxDate = new Date(timeMax);
        timeMaxDate.setHours(23, 59, 59, 999);
        
        const response = await calendar.events.list({
            calendarId: 'primary',
            timeMin: timeMinDate.toISOString(),
            timeMax: timeMaxDate.toISOString(),
            maxResults: 2500, // Increased to handle more events (Google's max is 2500)
            singleEvents: true,
            orderBy: 'startTime',
        });

        // Load configured events to use user settings
        const configuredEvents = loadConfiguredEvents();
        const configuredEventMap = new Map(configuredEvents.map(e => [e.id, e]));
        
        // Get set of Google Calendar event IDs from the API response
        const googleCalendarEventIds = new Set((response.data.items || []).map(e => e.id));

        // Format events according to original_tasks.json format, using configured settings
        // Filter out all-day events
        const googleCalendarTasks = (response.data.items || [])
            .filter(event => !!event.start.dateTime) // Only include events with specific times (exclude all-day)
            .map(event => {
                const configured = configuredEventMap.get(event.id);
                const start = event.start.dateTime;
                const end = event.end.dateTime;
                
                const startDate = new Date(start);
                const endDate = new Date(end);
                
                // Format start_time as "HH:MM" (without seconds)
                const startHours = String(startDate.getHours()).padStart(2, '0');
                const startMinutes = String(startDate.getMinutes()).padStart(2, '0');
                const start_time = `${startHours}:${startMinutes}`;
                
                // Calculate duration in hours and minutes
                const durationMs = endDate.getTime() - startDate.getTime();
                const durationHours = Math.floor(durationMs / (1000 * 60 * 60));
                const durationMinutes = Math.floor((durationMs % (1000 * 60 * 60)) / (1000 * 60));
                const duration = `${String(durationHours).padStart(2, '0')}:${String(durationMinutes).padStart(2, '0')}`;
                
                // Use configured values if available, otherwise use defaults
                // Convert numeric priority to string if needed (for backward compatibility)
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
                    type: configured?.purpose || 'personal', // Include purpose/type for analytics
                    start_date: `${startDate.getFullYear()}-${String(startDate.getMonth() + 1).padStart(2, '0')}-${String(startDate.getDate()).padStart(2, '0')}`,
                    durationMinutes: Math.floor(durationMs / (1000 * 60)) // Duration in minutes for calculations
                };
            });
        
        // Also include manually added events from user_data.json that aren't in Google Calendar yet
        // These are events with IDs starting with "manual_" that don't have corresponding Google Calendar events
        const manualTasks = configuredEvents
            .filter(event => event.id && event.id.startsWith('manual_') && !googleCalendarEventIds.has(event.id))
            .map(event => {
                // Convert numeric priority to string if needed
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
                
                // Only include time info if the event has start and end times
                if (event.start && event.end && event.start.trim() !== '' && event.end.trim() !== '') {
                    try {
                        const startDate = new Date(event.start);
                        const endDate = new Date(event.end);
                        
                        // Format start_time as "HH:MM"
                        const startHours = String(startDate.getHours()).padStart(2, '0');
                        const startMinutes = String(startDate.getMinutes()).padStart(2, '0');
                        start_time = `${startHours}:${startMinutes}`;
                        
                        // Calculate duration
                        const durationMs = endDate.getTime() - startDate.getTime();
                        const durationHours = Math.floor(durationMs / (1000 * 60 * 60));
                        const durMinutes = Math.floor((durationMs % (1000 * 60 * 60)) / (1000 * 60));
                        duration = `${String(durationHours).padStart(2, '0')}:${String(durMinutes).padStart(2, '0')}`;
                        durationMinutes = Math.floor(durationMs / (1000 * 60));
                        
                        // Format start_date
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
                    isManual: true // Flag to indicate this is a manually added event not yet synced
                };
            });
        
        // Combine Google Calendar events and manual events
        const allTasks = [...googleCalendarTasks, ...manualTasks];

        res.json({ tasks: allTasks });
    } catch (error) {
        console.error('Error fetching calendar:', error);
        res.status(500).json({ error: 'Failed to fetch calendar events' });
    }
});

// API endpoint to get events that need configuration
app.get('/api/setup/events', async (req, res) => {
    if (!req.user || !req.user.accessToken) {
        return res.status(401).json({ error: 'Not authenticated' });
    }

        try {
            const timeRange = req.query.range || 'week'; // Default to week
            const now = new Date();
            
            // Set time range: week (7 days) or month (30 days) from TODAY
            const timeMax = new Date(now);
            if (timeRange === 'month') {
                timeMax.setDate(timeMax.getDate() + 30); // Next 30 days from today
            } else {
                timeMax.setDate(timeMax.getDate() + 7); // Next 7 days from today
            }
            
            // Set time to start of day (00:00:00) for timeMin to include all events today
            const timeMinDate = new Date(now);
            timeMinDate.setHours(0, 0, 0, 0);
            
            // Set timeMax to end of day (23:59:59) on the last day of the range
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
            maxResults: 2500, // Increased to handle more events (Google's max is 2500)
            singleEvents: true,
            orderBy: 'startTime',
        });

        // Load already configured events
        const configuredEvents = loadConfiguredEvents();
        const configuredEventMap = new Map(configuredEvents.map(e => [e.id, e]));
        const configuredEventIds = new Set(configuredEvents.map(e => e.id));
        
        console.log(`Total events from Google Calendar: ${response.data.items?.length || 0}`);
        console.log(`Already configured events: ${configuredEventIds.size}`);

        // Filter to show only new/unconfigured events
        // Excluding all-day events and already configured events
        // Note: Google Calendar API already filters by timeMin/timeMax, but we do additional filtering
        const newEvents = (response.data.items || [])
            .filter(event => {
                // Exclude all-day events (they only have date, not dateTime)
                const hasDateTime = !!event.start.dateTime;
                if (!hasDateTime) return false;
                
                // Additional validation: ensure event is within range
                // Note: Google Calendar API should already filter by timeMin/timeMax,
                // but we do a sanity check here. Use timeMinDate and timeMaxDate for comparison.
                const eventStart = new Date(event.start.dateTime);
                const isWithinRange = eventStart >= timeMinDate && eventStart <= timeMaxDate;
                
                if (!isWithinRange) {
                    console.log(`Event "${event.summary}" (${event.id}) outside range: ${eventStart.toISOString()} (range: ${timeMinDate.toISOString()} to ${timeMaxDate.toISOString()})`);
                    return false;
                }
                
                // Only include unconfigured events - exclude all configured events regardless of purpose
                const notConfigured = !configuredEventIds.has(event.id);
                if (!notConfigured) {
                    console.log(`Excluding configured event: "${event.summary}" (${event.id})`);
                }
                return notConfigured;
            })
            .map(event => {
                const start = event.start.dateTime;
                const end = event.end.dateTime;
                
                // Check if this event was previously configured
                const previouslyConfigured = configuredEventMap.get(event.id);
                
                return {
                    id: event.id,
                    name: event.summary || 'Untitled Event',
                    start: start,
                    end: end,
                    // Use previously configured values if available, otherwise use defaults
                    priority: previouslyConfigured?.priority || 'medium',
                    purpose: previouslyConfigured?.purpose || 'personal', // Default: personal (can be business, personal, or school)
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

// API endpoint to get available time ranges
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

        // Default time ranges if none exist
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

// API endpoint to save event configurations
app.post('/api/setup/save', async (req, res) => {
    if (!req.user || !req.user.accessToken) {
        return res.status(401).json({ error: 'Not authenticated' });
    }

    try {
        const { events, timeRanges } = req.body;
        if (!events || !Array.isArray(events)) {
            return res.status(400).json({ error: 'Invalid events data' });
        }

        // Load existing configured events and data
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

        // Update or add new configurations
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

        // Save to user_data.json with both tasks format and configured events tracking
        const configuredEventsArray = Array.from(configuredEventMap.values());
        
        const dataToStore = {
            configuredEvents: configuredEventsArray, // Store full event configs for tracking
            timeRanges: timeRanges || existingData.timeRanges || null, // Store time ranges
            tasks: configuredEventsArray.map(event => {
                const startDate = new Date(event.start);
                const endDate = new Date(event.end);
                
                // Format start_date as YYYY-MM-DD
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
                
                // Convert numeric priority to string if needed (for backward compatibility)
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
                    type: event.purpose || 'personal' // Default to personal if not set
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

// Route to serve add-events page
app.get('/add-events', (req, res) => {
    if (!req.user) {
        return res.redirect('/');
    }
    res.sendFile(path.join(__dirname, 'public', 'add-events.html'));
});

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

        // Process Google Calendar events (excluding all-day events)
        const configuredEvents = [];
        const tasks = [];

        (response.data.items || []).forEach(event => {
            // Skip all-day events
            if (!event.start.dateTime) return;

            const start = event.start.dateTime;
            const end = event.end.dateTime;
            const startDate = new Date(start);
            const endDate = new Date(end);

            // Format for configuredEvents - using defaults, no existing config preserved
            configuredEvents.push({
                id: event.id,
                name: event.summary || 'Untitled Event',
                start: start,
                end: end,
                priority: 'medium',
                purpose: 'personal',
                fixed: false
            });

            // Format for tasks array
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

            // Format for tasks array - using defaults, no existing config preserved
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

        // Read events from new_events.json file if it exists
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

        // Combine events from request body and new_events.json
        const allNewEvents = [...newEventsFromFile, ...events];

        // Process all new manually added events (from file + request)
        allNewEvents.forEach((event, index) => {
            // Generate a unique ID for manually added events
            const eventId = `manual_${Date.now()}_${index}_${Math.random().toString(36).substr(2, 9)}`;
            
            // Initialize ALL fields as empty strings first - no defaults
            let startISO = '';
            let endISO = '';
            let startDate = '';
            let startTime = '';
            let duration = '';
            const name = (event.name !== undefined && event.name !== null) ? String(event.name) : '';
            const priority = (event.priority !== undefined && event.priority !== null) ? String(event.priority) : '';
            const purpose = (event.purpose !== undefined && event.purpose !== null) ? String(event.purpose) : '';
            const fixed = (event.fixed !== undefined && event.fixed !== null) ? Boolean(event.fixed) : false;
            
            // Only fill date/time fields if fixed is true AND all date/time values are provided
            if (fixed && event.date && event.startTime && event.endTime) {
                // Parse date and times to create ISO strings
                const startDateTime = new Date(`${event.date}T${event.startTime}`);
                const endDateTime = new Date(`${event.date}T${event.endTime}`);
                
                // If end time is before start time, assume it's next day
                if (endDateTime <= startDateTime) {
                    endDateTime.setDate(endDateTime.getDate() + 1);
                }
                
                startISO = startDateTime.toISOString();
                endISO = endDateTime.toISOString();
                
                // Format for tasks array
                const startYear = startDateTime.getFullYear();
                const startMonth = String(startDateTime.getMonth() + 1).padStart(2, '0');
                const startDay = String(startDateTime.getDate()).padStart(2, '0');
                startDate = `${startYear}-${startMonth}-${startDay}`;
                
                const startHours = String(startDateTime.getHours()).padStart(2, '0');
                const startMinutes = String(startDateTime.getMinutes()).padStart(2, '0');
                startTime = `${startHours}:${startMinutes}`;
                
                const durationMs = endDateTime.getTime() - startDateTime.getTime();
                const durationHours = Math.floor(durationMs / (1000 * 60 * 60));
                const durationMinutes = Math.floor((durationMs % (1000 * 60 * 60)) / (1000 * 60));
                duration = `${String(durationHours).padStart(2, '0')}:${String(durationMinutes).padStart(2, '0')}`;
            }
            
            // Add to configuredEvents array - all missing fields are empty strings
            configuredEvents.push({
                id: eventId,
                name: name,
                start: startISO,
                end: endISO,
                priority: priority,
                purpose: purpose,
                fixed: fixed
            });
            
            // Add to tasks array - all missing fields are empty strings
            tasks.push({
                name: name,
                fixed: fixed,
                priority: priority,
                start_date: startDate,
                start_time: startTime,
                duration: duration,
                type: purpose
            });
            
            console.log(`📝 Added new event: ${name || '(no name)'} - priority: ${priority || '(empty)'}, purpose: ${purpose || '(empty)'}, fixed: ${fixed}`);
        });

        // Create fresh user_data.json with Google Calendar events + new events
        const filePath = path.join(__dirname, 'user_data.json');
        const newData = {
            configuredEvents: configuredEvents,
            tasks: tasks,
            timeRanges: null
        };

        // Save new user_data.json
        fs.writeFileSync(filePath, JSON.stringify(newData, null, '\t'), 'utf8');
<<<<<<< HEAD
        console.log(`✅ Created fresh user_data.json with ${configuredEvents.length} events:`);
        console.log(`   - ${(response.data.items || []).filter(e => e.start?.dateTime).length} from Google Calendar`);
        console.log(`   - ${newEventsFromFile.length} from new_events.json`);
        console.log(`   - ${events.length} from request body`);
        console.log(`   - ${allNewEvents.length} total new events processed`);
        console.log(`📁 Saved to: ${filePath}`);
        
        // Verify the file was written correctly
        if (fs.existsSync(filePath)) {
            const savedData = JSON.parse(fs.readFileSync(filePath, 'utf8'));
            console.log(`✅ Verification: user_data.json contains ${savedData.configuredEvents?.length || 0} configuredEvents and ${savedData.tasks?.length || 0} tasks`);
        }
=======
        console.log(`Created user_data.json`);
>>>>>>> 6d1a0dba7a4647d2e49376ad45adfdd565a02873

        // Always create updated_data.json from user_data.json (synchronously to ensure it happens)
        const updatedDataPath = path.join(__dirname, 'updated_data.json');
        try {
            fs.copyFileSync(filePath, updatedDataPath);
            console.log(`✅ Created/updated updated_data.json from user_data.json`);
            
            // Verify the copy
            if (fs.existsSync(updatedDataPath)) {
                const updatedData = JSON.parse(fs.readFileSync(updatedDataPath, 'utf8'));
                const updatedStats = fs.statSync(updatedDataPath);
                console.log(`✅ Verification: updated_data.json contains ${updatedData.configuredEvents?.length || 0} configuredEvents and ${updatedData.tasks?.length || 0} tasks`);
                console.log(`📊 updated_data.json file size: ${updatedStats.size} bytes`);
                
                // Check if new events are in updated_data.json
                const newEventNames = allNewEvents.map(e => e.name || '').filter(n => n);
                if (newEventNames.length > 0) {
                    const foundInUpdated = newEventNames.filter(name => 
                        updatedData.tasks?.some(t => t.name === name) || 
                        updatedData.configuredEvents?.some(c => c.name === name)
                    );
                    console.log(`🔍 New events in updated_data.json: ${foundInUpdated.length}/${newEventNames.length}`);
                    if (foundInUpdated.length < newEventNames.length) {
                        const missing = newEventNames.filter(n => !foundInUpdated.includes(n));
                        console.error(`❌ Missing events in updated_data.json: ${missing.join(', ')}`);
                    }
                }
            }
        } catch (copyError) {
            console.error(`❌ Error copying to updated_data.json:`, copyError);
        }
        
        // Also run dummy_reschedule.py as backup (but we've already copied above)
        const { exec } = require('child_process');
        const pythonScript = path.join(__dirname, 'dummy_reschedule.py');
        const scriptDir = __dirname;
        
<<<<<<< HEAD
        console.log(`🔄 Running dummy_reschedule.py as backup...`);
        exec(`cd "${scriptDir}" && python3 dummy_reschedule.py`, { 
            cwd: scriptDir,
            maxBuffer: 1024 * 1024 * 10
        }, (error, stdout, stderr) => {
            if (error) {
                console.error(`⚠️ dummy_reschedule.py had error (but updated_data.json already created):`, error.message);
            } else {
                console.log(`✅ dummy_reschedule.py also executed successfully`);
=======
        exec(`cd "${scriptDir}" && python3 dummy_reschedule.py`, (error, stdout, stderr) => {
            if (error) {
                console.error(`Error code: ${error.code}`);
                console.error(`Error signal: ${error.signal}`);
                if (stderr) console.error(`stderr: ${stderr}`);
            } else {
                console.log(`✅ dummy_reschedule.py executed successfully`);
                if (stdout) console.log(`stdout: ${stdout}`);
                if (stderr) console.log(`stderr: ${stderr}`);
                
                // Verify the file was created
                const updatedDataPath = path.join(scriptDir, 'updated_data.json');
                if (fs.existsSync(updatedDataPath)) {
                    console.log(`✅ updated_data.json created at: ${updatedDataPath}`);
                } else {
                    console.error(`❌ updated_data.json was NOT created at: ${updatedDataPath}`);
                }
>>>>>>> 6d1a0dba7a4647d2e49376ad45adfdd565a02873
            }
        });

        res.json({ success: true });
    } catch (error) {
        console.error('Error saving new events:', error);
        res.status(500).json({ error: 'Failed to save events' });
    }
});

// API endpoint to sync events from updated_data.json to Google Calendar
app.post('/api/calendar/sync', async (req, res) => {
    if (!req.user || !req.user.accessToken) {
        return res.status(401).json({ error: 'Not authenticated' });
    }

    try {
        // Read updated_data.json
        const updatedDataPath = path.join(__dirname, 'updated_data.json');
        if (!fs.existsSync(updatedDataPath)) {
            return res.status(404).json({ error: 'updated_data.json not found' });
        }

        const updatedData = JSON.parse(fs.readFileSync(updatedDataPath, 'utf8'));
        const configuredEvents = updatedData.configuredEvents || [];

        // Filter for manually added events (those with id starting with "manual_")
        const manualEvents = configuredEvents.filter(event => event.id && event.id.startsWith('manual_'));

        if (manualEvents.length === 0) {
            return res.json({ 
                success: true, 
                message: 'No new manual events to sync',
                created: 0,
                skipped: 0
            });
        }

        // Set up Google Calendar API client
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

        // Create events in Google Calendar
        const results = {
            created: 0,
            skipped: 0,
            errors: [],
            createdEventIds: [] // Track created event IDs for revert
        };

        for (const event of manualEvents) {
            try {
                // Skip events without date/time (empty strings)
                if (!event.start || !event.end || event.start === '' || event.end === '') {
                    console.log(`⏭️ Skipping event "${event.name}" - no date/time specified`);
                    results.skipped++;
                    continue;
                }

                // Create Google Calendar event object
                // Handle UTC timestamps properly - convert UTC to Eastern Time
                let startDateTime = event.start;
                let endDateTime = event.end;
                const timezone = 'America/New_York'; // Use Eastern Time
                
                // If the ISO string is in UTC (ends with Z), we need to convert it
                // Google Calendar API expects the time to be specified in the timezone we declare
                // So if we have "2025-11-02T17:00:00.000Z" (5 PM UTC), and the user meant 12 PM ET,
                // we need to convert it to "2025-11-02T12:00:00" with timezone "America/New_York"
                if (event.start.endsWith('Z')) {
                    // Parse the UTC date
                    const utcDate = new Date(event.start);
                    const utcEndDate = new Date(event.end);
                    
                    // Convert UTC to ET: ET is UTC-5 (EST) or UTC-4 (EDT)
                    // Use a simple approximation: ET is typically UTC-5
                    // For more accuracy, we could use a library, but for now this should work
                    const etOffsetHours = -5; // EST offset (adjust to -4 for EDT if needed)
                    
                    const formatET = (utcDate) => {
                        // Create a date object that represents the ET time
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
                    // If it has a timezone offset but not Z, just remove the offset part
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

                // Insert event into Google Calendar
                const response = await calendar.events.insert({
                    calendarId: 'primary',
                    resource: calendarEvent
                });

                const googleCalendarId = response.data.id;
                console.log(`✅ Created event in Google Calendar: "${event.name}" (ID: ${googleCalendarId})`);
                results.created++;
                results.createdEventIds.push({
                    googleCalendarId: googleCalendarId,
                    eventName: event.name,
                    manualId: event.id
                });

            } catch (error) {
                console.error(`❌ Error creating event "${event.name}":`, error.message);
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
            console.log(`💾 Saved sync info to sync_info.json with ${results.createdEventIds.length} event IDs`);
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

// API endpoint to revert the last sync (delete synced events from Google Calendar)
app.post('/api/calendar/revert', async (req, res) => {
    if (!req.user || !req.user.accessToken) {
        return res.status(401).json({ error: 'Not authenticated' });
    }

    try {
        // Read sync_info.json to get the list of created event IDs
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

        // Set up Google Calendar API client
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

        // Delete events from Google Calendar
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

                console.log(`✅ Deleted event from Google Calendar: "${eventInfo.eventName}" (ID: ${eventInfo.googleCalendarId})`);
                results.deleted++;

            } catch (error) {
                console.error(`❌ Error deleting event "${eventInfo.eventName}":`, error.message);
                results.errors.push({
                    event: eventInfo.eventName,
                    error: error.message
                });
            }
        }

        // Delete sync_info.json after successful revert
        if (results.deleted > 0) {
            try {
                fs.unlinkSync(syncInfoPath);
                console.log(`🗑️ Deleted sync_info.json`);
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

// API endpoint to check which scopes are currently authorized
app.get('/api/calendar/scopes', async (req, res) => {
    if (!req.user || !req.user.accessToken) {
        return res.status(401).json({ error: 'Not authenticated' });
    }

    try {
        // Use tokeninfo endpoint to check what scopes were granted
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

// API endpoint to check/verify synced events in Google Calendar
app.get('/api/calendar/verify', async (req, res) => {
    if (!req.user || !req.user.accessToken) {
        return res.status(401).json({ error: 'Not authenticated' });
    }

    try {
        // Read sync_info.json to get synced event IDs
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

        // Set up Google Calendar API client
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

        // Verify each synced event exists in Google Calendar
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

// Helper function to load configured events
function loadConfiguredEvents() {
    const filePath = path.join(__dirname, 'user_data.json');
    try {
        if (fs.existsSync(filePath)) {
            const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
            // If we have a stored list of configured event IDs, return it
            // For now, we'll track by fetching all events and comparing
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

