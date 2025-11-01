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
    scope: ['profile', 'email', 'https://www.googleapis.com/auth/calendar.readonly']
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

        // Format events according to original_tasks.json format, using configured settings
        // Filter out all-day events
        const tasks = (response.data.items || [])
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
                    duration: duration
                };
            });

        res.json({ tasks: tasks });
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
        const configuredEventIds = new Set(configuredEvents.map(e => e.id));
        
        console.log(`Total events from Google Calendar: ${response.data.items?.length || 0}`);
        console.log(`Already configured events: ${configuredEventIds.size}`);

        // Filter to only show new/unconfigured events, excluding all-day events
        // Note: Google Calendar API already filters by timeMin/timeMax, but we do additional filtering
        const newEvents = (response.data.items || [])
            .filter(event => {
                // Exclude all-day events (they only have date, not dateTime)
                const hasDateTime = !!event.start.dateTime;
                if (!hasDateTime) return false;
                
                // Exclude already configured events
                const notConfigured = !configuredEventIds.has(event.id);
                if (!notConfigured) return false;
                
                // Additional validation: ensure event is within range
                // Note: Google Calendar API should already filter by timeMin/timeMax,
                // but we do a sanity check here. Use timeMinDate and timeMaxDate for comparison.
                const eventStart = new Date(event.start.dateTime);
                const isWithinRange = eventStart >= timeMinDate && eventStart <= timeMaxDate;
                
                if (!isWithinRange) {
                    console.log(`Event "${event.summary}" (${event.id}) outside range: ${eventStart.toISOString()} (range: ${timeMinDate.toISOString()} to ${timeMaxDate.toISOString()})`);
                }
                
                return isWithinRange;
            })
            .map(event => {
                const start = event.start.dateTime;
                const end = event.end.dateTime;
                
                return {
                    id: event.id,
                    name: event.summary || 'Untitled Event',
                    start: start,
                    end: end,
                    priority: 'medium', // Default: Medium
                    purpose: 'personal', // Default: personal (can be business, personal, or school)
                    fixed: false // Default: not fixed
                };
            });

        console.log(`Returning ${newEvents.length} events for ${timeRange} view`);
        res.json({ events: newEvents });
    } catch (error) {
        console.error('Error fetching setup events:', error);
        res.status(500).json({ error: 'Failed to fetch events' });
    }
});

// API endpoint to save event configurations
app.post('/api/setup/save', async (req, res) => {
    if (!req.user || !req.user.accessToken) {
        return res.status(401).json({ error: 'Not authenticated' });
    }

    try {
        const { events } = req.body;
        if (!events || !Array.isArray(events)) {
            return res.status(400).json({ error: 'Invalid events data' });
        }

        // Load existing configured events
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
        const filePath = path.join(__dirname, 'user_data.json');
        const configuredEventsArray = Array.from(configuredEventMap.values());
        
        const dataToStore = {
            configuredEvents: configuredEventsArray, // Store full event configs for tracking
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

        // Prepare new events data with name, priority, fixed, and date/time if fixed
        const newEventsData = events.map(event => {
            const eventData = {
                name: event.name,
                priority: event.priority || 'medium',
                fixed: event.fixed || false
            };
            
            // Include date, startTime, and endTime if fixed is true
            if (event.fixed && event.date && event.startTime && event.endTime) {
                eventData.date = event.date;
                eventData.startTime = event.startTime;
                eventData.endTime = event.endTime;
            }
            
            return eventData;
        });

        // Save to new_events.json
        const filePath = path.join(__dirname, 'new_events.json');
        fs.writeFileSync(filePath, JSON.stringify(newEventsData, null, '\t'), 'utf8');
        console.log(`New events saved to ${filePath}`);

        res.json({ success: true });
    } catch (error) {
        console.error('Error saving new events:', error);
        res.status(500).json({ error: 'Failed to save events' });
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
    console.log(`Server is running on http://localhost:${PORT}`);
    console.log('Make sure you have set up your Google OAuth credentials in .env file');
});

