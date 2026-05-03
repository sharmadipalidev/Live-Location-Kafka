# Kafka Live Location Sharing

[Watch the YouTube demo video]()

A real-time live location sharing app built with **Node.js**, **Express**, **Socket.IO**, **KafkaJS**, and **Leaflet**. The project lets authenticated users open a live map, share their current position, and receive live updates from other connected users through a Kafka-backed event pipeline.

## Overview

This project is designed to demonstrate a simple but realistic realtime architecture:

1. A user signs in through an external auth service.
2. The server validates the returned access token and opens a session.
3. The client sends location updates over Socket.IO.
4. The server publishes each update to a Kafka topic.
5. Kafka consumers can read the same stream and forward or process the data.
6. The live map updates markers and status labels in the browser.

The UI is a full-screen map experience with a floating control bar, live connection state, user markers, and a quick recenter action.

## Features

- Real-time user location sharing on an interactive map
- Socket.IO session handling with token-based authentication
- Kafka event publishing for location updates
- Live broadcast of marker changes to all connected users
- Login, auth callback, and session redirect pages
- Logout flow with local session cleanup
- Health check endpoint for server monitoring
- Responsive map UI built with Leaflet and OpenStreetMap tiles

## Tech Stack

- **Backend:** Node.js, Express
- **Realtime:** Socket.IO
- **Streaming:** KafkaJS
- **Map UI:** Leaflet
- **Authentication:** External OAuth/token service
- **Client Storage:** `localStorage` for session token and user info

## Project Structure

```text
.
├── index.js
├── kafka-client.js
├── database-processor.js
├── package.json
└── public
    ├── auth.html
    ├── index.html
    └── login.html
```

## How It Works

### Authentication flow

- Visiting `/` loads the login screen.
- The login page redirects to the external auth service through `/login`.
- After successful sign-in, the auth service sends the user to `/auth`.
- The auth page exchanges the authorization code for an access token at `/auth/exchange`.
- The token and basic user profile are saved in browser storage.
- The user is redirected to `/home`, which loads the live map.

### Realtime location flow

- The browser connects to Socket.IO with the saved access token.
- The server validates the token using the JWKS endpoint from the auth service.
- When the client sends `client:location:update`, the server publishes the payload to Kafka.
- The Kafka consumer in `index.js` listens to the `location-updates` topic and emits `server:location:update` to every connected client.
- The map updates markers, tooltips, and the live status strip in real time.

### Database processor

The `database-processor.js` file currently acts as a Kafka consumer example. It reads the same `location-updates` topic and logs the data in a DB-style processing step. This is a good place to extend the app with real persistence later.

## Available Routes

| Route | Purpose |
| --- | --- |
| `/` | Landing page that checks session state and routes the user |
| `/login` | Redirects to the external auth provider |
| `/auth` | Handles the auth callback page |
| `/auth/exchange` | Exchanges authorization code for access token |
| `/home` | Loads the live map UI |
| `/health` | Returns `{ healthy: true }` |

## Environment Variables

The server reads these environment variables:

| Variable | Purpose | Default |
| --- | --- | --- |
| `PORT` | Server port | `5000` |
| `AUTH_ORIGIN` | Base URL of the auth service | `http://localhost:8000` |
| `AUTH_CLIENT_ID` | OAuth client ID | built-in sample value |
| `AUTH_CLIENT_SECRET` | OAuth client secret | built-in sample value |
| `AUTHORIZATION_ENDPOINT` | Sign-in endpoint for auth redirect | `${AUTH_ORIGIN}/api/auth/signin` |
| `AUTH_REDIRECT_URI` | Redirect URI used during auth exchange | `${protocol}://${host}/auth` |

The live location app uses a custom OIDC and OAuth service. You need to clone and run that separate auth repository on another port before starting this project, because the client ID and client secret are created through its registration flow.

The registration endpoint used to create the credentials is:

```text
http://localhost:8000/api/auth/client/register
```

After registering a client, use the returned `client_id` and `client_secret` values when starting the live location app. These credentials are unique for each registration, so they should not be hardcoded in the project.

## Prerequisites

- Node.js 18 or newer
- A running Kafka broker on `localhost:9092`
- Your custom OIDC and OAuth service running separately on another port
- An external auth service that exposes:
  - `/api/auth/signin`
  - `/api/auth/token`
  - `/api/auth/certs`
  - `/api/auth/client/register`

Make sure the auth service is available before running this project.

## Installation

1. Install dependencies.

```bash
pnpm install
```

If you prefer npm, this also works:

```bash
npm install
```

2. Make sure Kafka is running locally.

3. Start the auth service required by the app.

## Running the App

Start the server:

```bash
pnpm dev
```

Or with npm:

```bash
npm run dev
```

If you want to use the local credentials flow, run the app with your own registered values:

```bash
PORT=5000 AUTH_CLIENT_ID=<your-client-id> AUTH_CLIENT_SECRET=<your-client-secret> npm run dev
```

This command should be executed in the live location project terminal after your separate OIDC/OAuth repo is already running and your own client credentials have been registered.

Then open:

- `http://localhost:5000/` for the login flow
- `http://localhost:5000/home` for the live map after authentication

## What You Will See

- A login redirect page that checks whether a valid session already exists
- A callback page that exchanges the auth code for a token
- A live map screen that shows:
  - your location marker
  - other connected users
  - connection status
  - last update time
  - a people-visible counter
  - a center-on-me button

## Kafka Topic

The application uses one topic:

- `location-updates`

Each message contains:

- `id`
- `userName`
- `latitude`
- `longitude`
- `updatedAt`

## Browser Storage

The client stores the following values in `localStorage`:

- `accessToken`
- `user`
- `isLoggedIn`

These values are cleared on logout or when the session is invalid.

## Troubleshooting

### Login does not redirect correctly

- Confirm `AUTH_ORIGIN` points to the auth service.
- Confirm the auth service is running and reachable.
- Check that the redirect URI matches `/auth` on this app.

### Live map does not connect

- Verify the server is running on the expected port.
- Make sure the access token in `localStorage` is valid.
- Check browser console logs for Socket.IO connection errors.

### No location updates appear

- Allow browser geolocation permissions.
- Ensure the device/browser can access GPS or network location.
- Confirm Kafka is running and the `location-updates` topic can be produced to.

### Token validation fails

- Confirm the auth service exposes a valid JWKS endpoint.
- Check `AUTH_CLIENT_ID` and `AUTH_CLIENT_SECRET`.
- Make sure the access token has not expired.

## Development Notes

- The app uses Leaflet with OpenStreetMap tiles for the map base layer.
- The server validates JWT access tokens using the auth service JWKS response.
- Socket.IO acts as the realtime bridge between the browser and Kafka.
- `database-processor.js` is currently a logging consumer and can be extended to persist location data.

## Future Improvements

- Persist location history in a real database
- Show a list of active users
- Add route history or playback mode
- Filter updates by room, team, or group
- Add better error states for auth and geolocation failures
- Support deployment configuration for non-local Kafka brokers

## License

This project currently uses the `ISC` license from `package.json`.
