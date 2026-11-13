import AsyncStorage from "@react-native-async-storage/async-storage";
import type { Message, RoomSummary, Session } from "./types";

// Set EXPO_PUBLIC_API_URL to the backend origin. Android emulators use 10.0.2.2
// to reach the host machine; physical devices should use the host's LAN IP.
export const API_URL = (process.env.EXPO_PUBLIC_API_URL || "http://10.0.2.2:3000").replace(/\/$/, "");
const SESSION_KEY = "chat.session";

export const sessionStore = {
  async get(): Promise<Session | null> {
    try {
      const saved = await AsyncStorage.getItem(SESSION_KEY);
      return saved ? (JSON.parse(saved) as Session) : null;
    } catch {
      return null;
    }
  },
  async set(value: Session | null): Promise<void> {
    if (value) await AsyncStorage.setItem(SESSION_KEY, JSON.stringify(value));
    else await AsyncStorage.removeItem(SESSION_KEY);
  },
};

async function request<T>(path: string, token?: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      ...init,
      headers: {
        Accept: "application/json",
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...init?.headers,
      },
    });
  } catch {
    throw new Error(`Could not reach the chat server at ${API_URL}. Check the server URL and network.`);
  }

  const text = await response.text();
  let value: unknown;
  try {
    value = text ? JSON.parse(text) : null;
  } catch {
    value = text;
  }
  if (!response.ok) {
    const detail = value && typeof value === "object" && "error" in value
      ? String((value as { error: unknown }).error)
      : value && typeof value === "object" && "message" in value
        ? String((value as { message: unknown }).message)
        : typeof value === "string" && value
          ? value
          : `Request failed (${response.status})`;
    if (response.status === 401) await sessionStore.set(null);
    throw new Error(detail);
  }
  return value as T;
}

export const api = {
  login: (username: string, password: string) =>
    request<Session>("/auth/login", undefined, { method: "POST", body: JSON.stringify({ username, password }) }),
  register: (username: string, password: string) =>
    request<Session>("/auth/register", undefined, { method: "POST", body: JSON.stringify({ username, password }) }),
  rooms: (token: string) => request<RoomSummary[]>("/rooms", token),
  messages: (token: string, roomId: string, query: { before?: number; after?: number; limit?: number } = {}) => {
    const params = new URLSearchParams();
    if (query.before !== undefined) params.set("before", String(query.before));
    if (query.after !== undefined) params.set("after", String(query.after));
    params.set("limit", String(query.limit ?? 50));
    return request<Message[]>(`/rooms/${encodeURIComponent(roomId)}/messages?${params.toString()}`, token);
  },
  createRoom: (token: string, members: string[], name?: string) =>
    request<{ id: string }>("/rooms", token, {
      method: "POST",
      body: JSON.stringify({ type: members.length === 1 && !name ? "dm" : "group", name, members }),
    }),
  addMember: (token: string, roomId: string, username: string) =>
    request<{ ok: true }>(`/rooms/${encodeURIComponent(roomId)}/members`, token, {
      method: "POST",
      body: JSON.stringify({ username }),
    }),
};
