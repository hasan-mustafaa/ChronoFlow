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
app.use(session({
    secret: process.env.SESSION_SECRET || 'your-secret-key-change-this-in-production',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false } // Set to true in production with HTTPS
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
        // Successful authentication - redirect to calendar page
        res.redirect('/calendar');
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
        
        const response = await calendar.events.list({
            calendarId: 'primary',
            timeMin: new Date().toISOString(),
            maxResults: 100, // Get more events to convert to tasks
            singleEvents: true,
            orderBy: 'startTime',
        });

        // Format events according to original_tasks.json format
        const tasks = (response.data.items || []).map(event => {
            const hasDateTime = !!event.start.dateTime;
            const start = event.start.dateTime || event.start.date;
            const end = event.end.dateTime || event.end.date;
            
            const startDate = new Date(start);
            const endDate = new Date(end);
            
            // For all-day events, use 00:00 as start time
            // For timed events, use the actual time
            let start_time;
            if (hasDateTime) {
                const startHours = String(startDate.getHours()).padStart(2, '0');
                const startMinutes = String(startDate.getMinutes()).padStart(2, '0');
                start_time = `${startHours}:${startMinutes}`;
            } else {
                // All-day event - default to 00:00
                start_time = "00:00";
            }
            
            // Calculate duration in hours and minutes
            const durationMs = endDate.getTime() - startDate.getTime();
            const durationHours = Math.floor(durationMs / (1000 * 60 * 60));
            const durationMinutes = Math.floor((durationMs % (1000 * 60 * 60)) / (1000 * 60));
            const duration = `${String(durationHours).padStart(2, '0')}:${String(durationMinutes).padStart(2, '0')}`;
            
            return {
                name: event.summary || 'Untitled Event',
                fixed: false, // Default as requested
                priority: 1, // Default as requested
                start_time: start_time,
                duration: duration
            };
        });

        // Store data in user_data.json file
        const dataToStore = {
            tasks: tasks
        };
        const filePath = path.join(__dirname, 'user_data.json');
        
        try {
            fs.writeFileSync(filePath, JSON.stringify(dataToStore, null, '\t'), 'utf8');
            console.log(`Calendar data saved to ${filePath}`);
        } catch (fileError) {
            console.error('Error saving data to file:', fileError);
            // Continue even if file write fails
        }

        res.json({ tasks: tasks });
    } catch (error) {
        console.error('Error fetching calendar:', error);
        res.status(500).json({ error: 'Failed to fetch calendar events' });
    }
});

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

