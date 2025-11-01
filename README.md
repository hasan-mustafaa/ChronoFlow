# ChronoFlow

A basic website with Google OAuth 2.0 authentication built with Node.js and Express.

## Features

- 🔐 Google OAuth 2.0 authentication
- 🎨 Modern, responsive UI
- 🔒 Secure session management
- 🚀 Easy setup and deployment

## Prerequisites

- Node.js (v14 or higher)
- npm (comes with Node.js)
- Google Cloud Platform account

## Setup Instructions

### 1. Install Dependencies

```bash
npm install
```

### 2. Set Up Google OAuth Credentials

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select an existing one
3. Enable the Google+ API:
   - Navigate to "APIs & Services" > "Library"
   - Search for "Google+ API" and enable it
4. Create OAuth 2.0 credentials:
   - Go to "APIs & Services" > "Credentials"
   - Click "Create Credentials" > "OAuth client ID"
   - Choose "Web application"
   - Add authorized redirect URI: `http://localhost:3000/auth/google/callback`
   - Copy your Client ID and Client Secret

### 3. Configure Environment Variables

Create a `.env` file in the root directory:

```env
GOOGLE_CLIENT_ID=your-google-client-id-here
GOOGLE_CLIENT_SECRET=your-google-client-secret-here
SESSION_SECRET=your-random-session-secret-here
PORT=3000
```

**Important:** 
- Replace `your-google-client-id-here` and `your-google-client-secret-here` with your actual Google OAuth credentials
- Generate a random string for `SESSION_SECRET` (you can use `openssl rand -base64 32` or any random string generator)

### 4. Run the Application

```bash
npm start
```

The server will start on `http://localhost:3000`

### 5. Test the Authentication

1. Open your browser and navigate to `http://localhost:3000`
2. Click "Sign in with Google"
3. Authorize the application with your Google account
4. You should see your profile information displayed

## Project Structure

```
ChronoFlow/
├── public/
│   └── index.html      # Frontend HTML file
├── server.js           # Express server with OAuth routes
├── package.json        # Dependencies and scripts
├── .env               # Environment variables (create this)
├── .gitignore         # Git ignore file
└── README.md          # This file
```

## Technologies Used

- **Express.js** - Web framework
- **Passport.js** - Authentication middleware
- **passport-google-oauth20** - Google OAuth 2.0 strategy
- **express-session** - Session management
- **dotenv** - Environment variable management

## Production Deployment

When deploying to production:

1. Update the authorized redirect URI in Google Cloud Console to match your production domain
2. Set `cookie.secure: true` in `server.js` (requires HTTPS)
3. Use a strong, randomly generated `SESSION_SECRET`
4. Consider using a proper session store (Redis, MongoDB) instead of the default memory store

## License

MIT
