# Realtime Chat — React Native

An Expo mobile client for the existing Realtime Chat API. It supports login/registration, persistent sessions, room creation, group membership, message history, live messages, typing indicators, presence, and reconnecting WebSockets.

## Run it

```sh
cd mobile
npm install
```

Set `EXPO_PUBLIC_API_URL` to the backend's reachable HTTP origin before starting Expo:

```sh
# Android emulator (default)
EXPO_PUBLIC_API_URL=http://10.0.2.2:3000 npx expo start

# iOS simulator
EXPO_PUBLIC_API_URL=http://localhost:3000 npx expo start

# Physical device: use the computer's LAN IP, e.g.
EXPO_PUBLIC_API_URL=http://192.168.1.20:3000 npx expo start
```

The API server must allow the mobile device's origin/network and be reachable over HTTP and WebSocket. The app turns the configured HTTP origin into `ws://.../ws` and uses the existing `?token=` WebSocket authentication protocol. For production, use HTTPS/WSS.

## Behavior and API compatibility

The mobile client follows the endpoints and event shapes in the web app's `api-contract`: `/auth/login`, `/auth/register`, `/rooms`, `/rooms/:id/messages`, `/rooms/:id/members`, and `/ws`. Auth tokens are stored with AsyncStorage. Message sends use optimistic pending messages and stable client message IDs, and the socket queues sends while reconnecting.
