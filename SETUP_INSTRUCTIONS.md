# Step-by-Step Setup Guide

## Step 1: Create the .env file

Create a file named `.env` in the ChronoFlow directory with the following content:

```
GOOGLE_CLIENT_ID=your-google-client-id-here
GOOGLE_CLIENT_SECRET=your-google-client-secret-here
SESSION_SECRET=DP2rUXnHSmVcERvo3rcQ8GdqLN67D+hDrcSIURt3S9A=
PORT=3000
```

## Step 2: Get Google OAuth Credentials

### 2.1 Create/Select a Google Cloud Project

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Click the project dropdown at the top
3. Click "New Project" or select an existing project
4. Give it a name (e.g., "ChronoFlow")
5. Click "Create"

### 2.2 Enable Google+ API

1. In the left sidebar, go to **"APIs & Services"** > **"Library"**
2. Search for "Google+ API" 
3. Click on it and press **"Enable"**

### 2.3 Configure OAuth Consent Screen

1. Go to **"APIs & Services"** > **"OAuth consent screen"**
2. Select **"External"** (unless you have a Google Workspace account)
3. Click **"Create"**
4. Fill in the required fields:
   - **App name**: ChronoFlow (or any name)
   - **User support email**: Your email
   - **Developer contact information**: Your email
5. Click **"Save and Continue"**
6. Click **"Add or Remove Scopes"**
   - Add: `userinfo.email` and `userinfo.profile`
   - Click **"Update"** > **"Save and Continue"**
7. Add yourself as a test user (under "Test users")
8. Click **"Save and Continue"** until finished

### 2.4 Create OAuth 2.0 Credentials

1. Go to **"APIs & Services"** > **"Credentials"**
2. Click **"+ CREATE CREDENTIALS"** > **"OAuth client ID"**
3. Choose **"Web application"** as the application type
4. Give it a name (e.g., "ChronoFlow Web Client")
5. Under **"Authorized redirect URIs"**, click **"+ ADD URI"**
6. Add: `http://localhost:3000/auth/google/callback`
7. Click **"Create"**
8. A popup will appear with your credentials:
   - **Client ID** (looks like: `123456789-abcdefghijk.apps.googleusercontent.com`)
   - **Client secret** (looks like: `GOCSPX-abcdefghijk123456`)
9. **Copy both values** - you'll need them!

### 2.5 Update your .env file

Open your `.env` file and replace the placeholders:

```
GOOGLE_CLIENT_ID=paste-your-client-id-here
GOOGLE_CLIENT_SECRET=paste-your-client-secret-here
SESSION_SECRET=DP2rUXnHSmVcERvo3rcQ8GdqLN67D+hDrcSIURt3S9A=
PORT=3000
```

**Example:**
```
GOOGLE_CLIENT_ID=123456789-abcdefghijk.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-abcdefghijk123456
SESSION_SECRET=DP2rUXnHSmVcERvo3rcQ8GdqLN67D+hDrcSIURt3S9A=
PORT=3000
```

## Step 3: Install Dependencies & Run

1. Open terminal in the ChronoFlow directory
2. Run: `npm install`
3. Run: `npm start`
4. Open browser: `http://localhost:3000`
5. Click "Sign in with Google" and test!

## Quick Command Reference

```bash
# Generate a new session secret (if needed)
openssl rand -base64 32

# Install dependencies
npm install

# Start the server
npm start
```

## Troubleshooting

- **"Invalid client" error**: Double-check your Client ID and Secret in `.env`
- **"Redirect URI mismatch"**: Make sure the redirect URI in Google Console exactly matches `http://localhost:3000/auth/google/callback`
- **"Access blocked"**: Make sure you added yourself as a test user in OAuth consent screen

