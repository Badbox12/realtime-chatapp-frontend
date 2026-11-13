import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  SafeAreaView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import * as Crypto from "expo-crypto";
import { api, sessionStore } from "./src/api";
import { ChatSocket } from "./src/chat-socket";
import type { ChatMessage, ConnectionStatus, Message, RoomSummary, ServerEvent, Session } from "./src/types";

const COLORS = {
  background: "#f5f7fb",
  white: "#ffffff",
  ink: "#172033",
  muted: "#788398",
  line: "#e4e9f1",
  blue: "#356df3",
  paleBlue: "#eaf0ff",
  red: "#c4313f",
  green: "#21a366",
};

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [loadingSession, setLoadingSession] = useState(true);

  useEffect(() => {
    sessionStore.get().then(setSession).finally(() => setLoadingSession(false));
  }, []);

  const signOut = useCallback(async () => {
    await sessionStore.set(null);
    setSession(null);
  }, []);

  if (loadingSession) {
    return <LoadingScreen label="Loading your chats…" />;
  }
  return session
    ? <ChatScreen key={session.user.id} auth={session} onSignOut={signOut} />
    : <AuthScreen onAuthenticated={setSession} />;
}

function LoadingScreen({ label }: { label: string }) {
  return <SafeAreaView style={styles.centered}><ActivityIndicator color={COLORS.blue} /><Text style={styles.mutedText}>{label}</Text></SafeAreaView>;
}

function AuthScreen({ onAuthenticated }: { onAuthenticated: (session: Session) => void }) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    const name = username.trim();
    if (!/^[a-zA-Z0-9_]{3,32}$/.test(name)) {
      setError("Username must be 3–32 letters, numbers, or underscores.");
      return;
    }
    if (password.length < 6 || password.length > 128) {
      setError("Password must be at least 6 characters.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const result = await (mode === "login" ? api.login(name, password) : api.register(name, password));
      await sessionStore.set(result);
      onAuthenticated(result);
    } catch (reason) {
      setError((reason as Error).message || "Could not sign in.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={styles.authScreen}>
      <StatusBar barStyle="dark-content" />
      <View style={styles.brandMark}><Text style={styles.brandMarkText}>R</Text></View>
      <Text style={styles.brandTitle}>Realtime Chat</Text>
      <Text style={styles.brandSubtitle}>{mode === "login" ? "Your conversations, all in one place." : "Create an account to start chatting."}</Text>
      <View style={styles.authCard}>
        <Text style={styles.cardTitle}>{mode === "login" ? "Welcome back" : "Create account"}</Text>
        <Text style={styles.label}>Username</Text>
        <TextInput
          style={styles.input}
          value={username}
          onChangeText={setUsername}
          autoCapitalize="none"
          autoCorrect={false}
          maxLength={32}
          placeholder="your_username"
          placeholderTextColor="#a0a9b8"
          returnKeyType="next"
        />
        <Text style={styles.label}>Password</Text>
        <TextInput
          style={styles.input}
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          maxLength={128}
          placeholder="At least 6 characters"
          placeholderTextColor="#a0a9b8"
          onSubmitEditing={submit}
          returnKeyType="go"
        />
        {!!error && <Text accessibilityRole="alert" style={styles.errorText}>{error}</Text>}
        <PrimaryButton title={busy ? "Please wait…" : mode === "login" ? "Log in" : "Register"} onPress={submit} disabled={busy} />
        <Pressable onPress={() => { setMode(mode === "login" ? "register" : "login"); setError(""); }} style={styles.modeSwitch}>
          <Text style={styles.mutedText}>{mode === "login" ? "New here? " : "Already have an account? "}<Text style={styles.linkText}>{mode === "login" ? "Register" : "Log in"}</Text></Text>
        </Pressable>
      </View>
      <Text style={styles.footerText}>Fast, simple, real-time conversations.</Text>
    </SafeAreaView>
  );
}

function ChatScreen({ auth, onSignOut }: { auth: Session; onSignOut: () => void }) {
  const [rooms, setRooms] = useState<RoomSummary[]>([]);
  const [activeRoomId, setActiveRoomId] = useState<string | null>(null);
  const [messagesByRoom, setMessagesByRoom] = useState<Record<string, ChatMessage[]>>({});
  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  const [online, setOnline] = useState<Record<string, true>>({});
  const [typing, setTyping] = useState<Record<string, Record<string, number>>>({});
  const [names, setNames] = useState<Record<string, string>>({ [auth.user.id]: auth.user.username });
  const [error, setError] = useState("");
  const [modal, setModal] = useState<"room" | "member" | null>(null);
  const [busy, setBusy] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [draft, setDraft] = useState("");
  const socketRef = useRef<ChatSocket | null>(null);
  const activeRoomRef = useRef<string | null>(null);
  const messagesRef = useRef(messagesByRoom);
  const roomsRef = useRef(rooms);
  const typingTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const lastTypingSent = useRef(0);
  const stopTypingTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => { activeRoomRef.current = activeRoomId; }, [activeRoomId]);
  useEffect(() => { messagesRef.current = messagesByRoom; }, [messagesByRoom]);
  useEffect(() => { roomsRef.current = rooms; }, [rooms]);

  const loadRooms = useCallback(async () => {
    try {
      const result = await api.rooms(auth.token);
      setRooms(result.map((room) => room.id === activeRoomRef.current ? { ...room, unread: 0 } : room));
    } catch (reason) {
      setError((reason as Error).message);
    }
  }, [auth.token]);

  const addMessage = useCallback((message: Message) => {
    setMessagesByRoom((current) => {
      const list = current[message.roomId] ?? [];
      const key = `${message.senderId}:${message.clientMsgId}`;
      const existing = list.findIndex((item) => `${item.senderId}:${item.clientMsgId}` === key);
      const next = [...list];
      if (existing >= 0) next[existing] = message;
      else next.push(message);
      next.sort((a, b) => ("pending" in a && a.pending ? Number.MAX_SAFE_INTEGER : a.seq) - ("pending" in b && b.pending ? Number.MAX_SAFE_INTEGER : b.seq));
      return { ...current, [message.roomId]: next };
    });
    setNames((current) => ({ ...current, [message.senderId]: message.senderName }));
    setRooms((current) => {
      const index = current.findIndex((room) => room.id === message.roomId);
      if (index < 0) return current;
      const room = current[index];
      const unread = message.senderId !== auth.user.id && message.roomId !== activeRoomRef.current ? room.unread + 1 : room.unread;
      const updated = { ...room, lastSeq: Math.max(room.lastSeq, message.seq), unread };
      return [updated, ...current.filter((_, i) => i !== index)];
    });
  }, [auth.user.id]);

  useEffect(() => {
    const socket = new ChatSocket(auth.token, {
      onStatus: setStatus,
      onUnauthorized: onSignOut,
      onEvent: (event: ServerEvent) => {
        if (event.type === "ready") {
          setOnline(Object.fromEntries(event.online.map((id) => [id, true as const])));
          void loadRooms();
          for (const [roomId, list] of Object.entries(messagesRef.current)) {
            const after = list.reduce((max, message) => "pending" in message && message.pending ? max : Math.max(max, message.seq), 0);
            void api.messages(auth.token, roomId, { after, limit: 100 }).then((missed) => missed.forEach(addMessage)).catch(() => undefined);
          }
        } else if (event.type === "message.ack" || event.type === "message.new") {
          addMessage(event.message);
          if (event.type === "message.new" && event.message.roomId === activeRoomRef.current) {
            socket.send({ type: "read", roomId: event.message.roomId, seq: event.message.seq });
          }
          if (!roomsRef.current.some((room) => room.id === event.message.roomId)) void loadRooms();
        } else if (event.type === "presence") {
          setOnline((current) => {
            if (event.status === "online") return { ...current, [event.userId]: true };
            const next = { ...current };
            delete next[event.userId];
            return next;
          });
        } else if (event.type === "typing") {
          const roomTyping = typingTimers.current[`${event.roomId}:${event.userId}`];
          if (roomTyping) clearTimeout(roomTyping);
          if (!event.isTyping) {
            setTyping((current) => {
              const nextRoom = { ...(current[event.roomId] ?? {}) };
              delete nextRoom[event.userId];
              return { ...current, [event.roomId]: nextRoom };
            });
            return;
          }
          const until = Date.now() + 5000;
          setTyping((current) => ({ ...current, [event.roomId]: { ...(current[event.roomId] ?? {}), [event.userId]: until } }));
          typingTimers.current[`${event.roomId}:${event.userId}`] = setTimeout(() => {
            setTyping((current) => {
              const nextRoom = { ...(current[event.roomId] ?? {}) };
              if (nextRoom[event.userId] === until) delete nextRoom[event.userId];
              return { ...current, [event.roomId]: nextRoom };
            });
          }, 5000);
        } else if (event.type === "room.joined") {
          void loadRooms();
        } else if (event.type === "error") {
          setError(event.code === "RATE_LIMITED" ? "You're sending messages too fast." : event.message ?? event.code);
        }
      },
    });
    socketRef.current = socket;
    socket.connect();
    void loadRooms();
    return () => {
      socket.close();
      socketRef.current = null;
      Object.values(typingTimers.current).forEach(clearTimeout);
      if (stopTypingTimer.current) clearTimeout(stopTypingTimer.current);
    };
  }, [auth.token, addMessage, loadRooms, onSignOut]);

  const openRoom = useCallback(async (roomId: string) => {
    setActiveRoomId(roomId);
    activeRoomRef.current = roomId;
    setRooms((current) => current.map((room) => room.id === roomId ? { ...room, unread: 0 } : room));
    setDraft("");
    if (!messagesRef.current[roomId]) {
      setLoadingMessages(true);
      try {
        const result = await api.messages(auth.token, roomId, { limit: 50 });
        setMessagesByRoom((current) => ({ ...current, [roomId]: result }));
        const last = result[result.length - 1];
        if (last) socketRef.current?.send({ type: "read", roomId, seq: last.seq });
      } catch (reason) {
        setError((reason as Error).message);
      } finally {
        setLoadingMessages(false);
      }
    }
  }, [auth.token]);

  const sendMessage = useCallback(() => {
    const roomId = activeRoomRef.current;
    const body = draft.trim();
    if (!roomId || !body) return;
    const clientMsgId = Crypto.randomUUID();
    const pending: ChatMessage = {
      roomId,
      clientMsgId,
      body,
      senderId: auth.user.id,
      senderName: auth.user.username,
      pending: true,
    };
    setMessagesByRoom((current) => ({ ...current, [roomId]: [...(current[roomId] ?? []), pending] }));
    socketRef.current?.send({ type: "message.send", roomId, clientMsgId, body });
    setDraft("");
    socketRef.current?.send({ type: "typing", roomId, isTyping: false });
    lastTypingSent.current = 0;
    if (stopTypingTimer.current) clearTimeout(stopTypingTimer.current);
  }, [auth.user.id, auth.user.username, draft]);

  function updateDraft(value: string) {
    setDraft(value);
    const roomId = activeRoomRef.current;
    if (!roomId) return;
    if (Date.now() - lastTypingSent.current > 3000) {
      socketRef.current?.send({ type: "typing", roomId, isTyping: true });
      lastTypingSent.current = Date.now();
    }
    if (stopTypingTimer.current) clearTimeout(stopTypingTimer.current);
    stopTypingTimer.current = setTimeout(() => {
      socketRef.current?.send({ type: "typing", roomId, isTyping: false });
      lastTypingSent.current = 0;
    }, 3000);
  }

  async function submitModal(first: string, second: string) {
    setBusy(true);
    setError("");
    try {
      if (modal === "room") {
        const members = first.split(",").map((name) => name.trim()).filter(Boolean);
        if (!members.length) throw new Error("Enter at least one username.");
        const result = await api.createRoom(auth.token, members, second.trim() || undefined);
        await loadRooms();
        setModal(null);
        await openRoom(result.id);
      } else if (modal === "member" && activeRoomId) {
        await api.addMember(auth.token, activeRoomId, first.trim());
        await loadRooms();
        setModal(null);
      }
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const activeRoom = rooms.find((room) => room.id === activeRoomId) ?? null;
  const currentMessages = activeRoomId ? messagesByRoom[activeRoomId] ?? [] : [];
  const typingNames = useMemo(() => Object.keys(typing[activeRoomId ?? ""] ?? {})
    .filter((id) => id !== auth.user.id)
    .map((id) => names[id] ?? "Someone"), [typing, activeRoomId, auth.user.id, names]);

  return (
    <SafeAreaView style={styles.appScreen}>
      <StatusBar barStyle="dark-content" />
      {!activeRoom ? (
        <>
          <View style={styles.listHeader}>
            <View style={styles.userBlock}>
              <View style={styles.avatar}><Text style={styles.avatarText}>{auth.user.username.slice(0, 1).toUpperCase()}</Text></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.headerTitle}>{auth.user.username}</Text>
                <View style={styles.connectionRow}><View style={[styles.statusDot, { backgroundColor: status === "online" ? COLORS.green : "#e9a23b" }]} /><Text style={styles.statusText}>{statusLabel(status)}</Text></View>
              </View>
              <Pressable onPress={onSignOut} style={styles.textButton}><Text style={styles.linkText}>Log out</Text></Pressable>
            </View>
            <View style={styles.sectionTitleRow}><Text style={styles.sectionTitle}>Messages</Text><Text style={styles.countText}>{rooms.length}</Text></View>
          </View>
          <FlatList
            data={rooms}
            keyExtractor={(item) => item.id}
            contentContainerStyle={rooms.length ? styles.roomList : styles.emptyList}
            ListEmptyComponent={<View style={styles.emptyState}><Text style={styles.emptyEmoji}>✉️</Text><Text style={styles.emptyTitle}>No chats yet</Text><Text style={styles.mutedText}>Start a conversation with someone.</Text></View>}
            renderItem={({ item }) => <RoomRow room={item} me={auth.user.username} onPress={() => void openRoom(item.id)} />}
          />
          <View style={styles.bottomBar}><PrimaryButton title="＋  Start a new chat" onPress={() => { setError(""); setModal("room"); }} /></View>
        </>
      ) : (
        <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined} keyboardVerticalOffset={8}>
          <View style={styles.chatHeader}>
            <Pressable onPress={() => { setActiveRoomId(null); activeRoomRef.current = null; void loadRooms(); }} style={styles.backButton}><Text style={styles.backText}>‹</Text></Pressable>
            <View style={styles.chatHeaderCopy}>
              <Text style={styles.headerTitle} numberOfLines={1}>{roomLabel(activeRoom, auth.user.username)}</Text>
              <Text style={styles.subheaderText} numberOfLines={1}>{activeRoom.members}</Text>
            </View>
            {activeRoom.type === "group" && <Pressable onPress={() => { setError(""); setModal("member"); }} style={styles.addButton}><Text style={styles.linkText}>Add</Text></Pressable>}
          </View>
          {loadingMessages && !messagesByRoom[activeRoom.id] ? <View style={styles.flexCentered}><ActivityIndicator color={COLORS.blue} /></View> : (
            <FlatList
              style={styles.flex}
              contentContainerStyle={styles.messageList}
              data={currentMessages}
              keyExtractor={(item) => `${item.senderId}:${item.clientMsgId}`}
              keyboardShouldPersistTaps="handled"
              ListEmptyComponent={<View style={styles.emptyState}><Text style={styles.emptyEmoji}>👋</Text><Text style={styles.emptyTitle}>Say hello</Text><Text style={styles.mutedText}>Your conversation starts here.</Text></View>}
              renderItem={({ item, index }) => <MessageBubble message={item} mine={item.senderId === auth.user.id} online={!!online[item.senderId]} showName={index === 0 || currentMessages[index - 1]?.senderId !== item.senderId} />}
            />
          )}
          <View style={styles.typingBox}><Text style={styles.typingText}>{typingNames.length === 1 ? `${typingNames[0]} is typing…` : typingNames.length > 1 ? `${typingNames.join(", ")} are typing…` : " "}</Text></View>
          <View style={styles.composerRow}>
            <TextInput
              style={styles.composerInput}
              value={draft}
              onChangeText={updateDraft}
              placeholder="Type a message…"
              placeholderTextColor="#9ba5b5"
              multiline
              maxLength={4000}
              blurOnSubmit={false}
              onSubmitEditing={sendMessage}
              returnKeyType="send"
            />
            <Pressable onPress={sendMessage} disabled={!draft.trim()} style={[styles.sendButton, !draft.trim() && styles.disabledButton]}><Text style={styles.sendButtonText}>↑</Text></Pressable>
          </View>
        </KeyboardAvoidingView>
      )}
      {!!error && <Pressable style={styles.errorBanner} onPress={() => setError("")}><Text style={styles.errorBannerText}>{error}  ×</Text></Pressable>}
      <RoomModal visible={modal !== null} mode={modal} busy={busy} onClose={() => setModal(null)} onSubmit={submitModal} />
    </SafeAreaView>
  );
}

function statusLabel(status: ConnectionStatus) {
  return status === "online" ? "Connected" : status === "connecting" ? "Connecting…" : "Reconnecting…";
}

function roomLabel(room: RoomSummary, me: string) {
  if (room.name) return room.name;
  const otherNames = room.members.split(", ").filter((name) => name !== me);
  return otherNames.join(", ") || "Just you";
}

function RoomRow({ room, me, onPress }: { room: RoomSummary; me: string; onPress: () => void }) {
  const title = roomLabel(room, me);
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.roomRow, pressed && styles.pressed]}>
      <View style={[styles.roomAvatar, room.type === "group" && styles.groupAvatar]}><Text style={[styles.roomAvatarText, room.type === "group" && styles.groupAvatarText]}>{room.type === "group" ? "#" : title.slice(0, 1).toUpperCase()}</Text></View>
      <View style={styles.roomCopy}>
        <View style={styles.roomTitleRow}><Text style={styles.roomTitle} numberOfLines={1}>{title}</Text>{room.unread > 0 && <View style={styles.unreadBadge}><Text style={styles.unreadText}>{room.unread}</Text></View>}</View>
        <Text style={styles.roomSubtitle} numberOfLines={1}>{room.type === "dm" ? "Direct message" : `${room.members.split(", ").length} members`}</Text>
      </View>
      <Text style={styles.chevron}>›</Text>
    </Pressable>
  );
}

function MessageBubble({ message, mine, online, showName }: { message: ChatMessage; mine: boolean; online: boolean; showName: boolean }) {
  const pending = "pending" in message && message.pending;
  const time = pending ? "Sending…" : new Date(message.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return (
    <View style={[styles.bubbleGroup, mine ? styles.mineGroup : styles.theirGroup]}>
      {showName && !mine && <View style={styles.senderLine}><View style={[styles.presenceDot, { backgroundColor: online ? COLORS.green : "#bdc5d1" }]} /><Text style={styles.senderName}>{message.senderName}</Text></View>}
      <View style={[styles.bubble, mine ? styles.myBubble : styles.theirBubble, pending && styles.pendingBubble]}><Text style={[styles.bubbleText, mine && styles.myBubbleText]}>{message.body}</Text></View>
      <Text style={styles.timeText}>{time}</Text>
    </View>
  );
}

function RoomModal({ visible, mode, busy, onClose, onSubmit }: {
  visible: boolean;
  mode: "room" | "member" | null;
  busy: boolean;
  onClose: () => void;
  onSubmit: (first: string, second: string) => void;
}) {
  const [first, setFirst] = useState("");
  const [second, setSecond] = useState("");
  useEffect(() => { if (!visible) { setFirst(""); setSecond(""); } }, [visible]);
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <View style={styles.modalCard}>
          <Text style={styles.cardTitle}>{mode === "member" ? "Add a member" : "Start a new chat"}</Text>
          <Text style={styles.modalHint}>{mode === "member" ? "Enter the username to add to this group." : "Enter usernames separated by commas."}</Text>
          <TextInput style={styles.input} value={first} onChangeText={setFirst} placeholder={mode === "member" ? "Username" : "Username(s)"} placeholderTextColor="#a0a9b8" autoCapitalize="none" autoCorrect={false} />
          {mode === "room" && <TextInput style={[styles.input, styles.modalSecondInput]} value={second} onChangeText={setSecond} placeholder="Group name (optional)" placeholderTextColor="#a0a9b8" maxLength={64} />}
          <View style={styles.modalActions}><Pressable onPress={onClose} style={styles.cancelButton}><Text style={styles.cancelText}>Cancel</Text></Pressable><PrimaryButton title={busy ? "Working…" : mode === "member" ? "Add member" : "Create chat"} onPress={() => onSubmit(first, second)} disabled={busy || !first.trim()} /></View>
        </View>
      </View>
    </Modal>
  );
}

function PrimaryButton({ title, onPress, disabled = false }: { title: string; onPress: () => void; disabled?: boolean }) {
  return <Pressable accessibilityRole="button" onPress={onPress} disabled={disabled} style={({ pressed }) => [styles.primaryButton, disabled && styles.disabledButton, pressed && !disabled && styles.buttonPressed]}><Text style={styles.primaryButtonText}>{title}</Text></Pressable>;
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  appScreen: { flex: 1, backgroundColor: COLORS.background },
  centered: { flex: 1, backgroundColor: COLORS.background, alignItems: "center", justifyContent: "center", gap: 12 },
  flexCentered: { flex: 1, alignItems: "center", justifyContent: "center" },
  authScreen: { flex: 1, backgroundColor: COLORS.background, alignItems: "center", justifyContent: "center", padding: 24 },
  brandMark: { width: 58, height: 58, borderRadius: 19, backgroundColor: COLORS.blue, alignItems: "center", justifyContent: "center", marginBottom: 15, shadowColor: COLORS.blue, shadowOpacity: 0.2, shadowRadius: 12, elevation: 5 },
  brandMarkText: { color: COLORS.white, fontSize: 28, fontWeight: "800" },
  brandTitle: { color: COLORS.ink, fontWeight: "800", fontSize: 27, letterSpacing: -0.5 },
  brandSubtitle: { color: COLORS.muted, fontSize: 14, marginTop: 7, marginBottom: 27, textAlign: "center" },
  authCard: { width: "100%", maxWidth: 430, borderRadius: 22, backgroundColor: COLORS.white, padding: 22, borderWidth: 1, borderColor: COLORS.line, shadowColor: "#172033", shadowOpacity: 0.04, shadowRadius: 18, elevation: 2 },
  cardTitle: { color: COLORS.ink, fontSize: 21, fontWeight: "750", marginBottom: 18 },
  label: { color: COLORS.ink, fontSize: 13, fontWeight: "650", marginBottom: 7, marginTop: 9 },
  input: { minHeight: 49, borderWidth: 1, borderColor: COLORS.line, backgroundColor: "#fbfcfe", borderRadius: 12, paddingHorizontal: 14, color: COLORS.ink, fontSize: 15 },
  errorText: { color: COLORS.red, fontSize: 13, marginTop: 12 },
  primaryButton: { backgroundColor: COLORS.blue, borderRadius: 12, minHeight: 49, alignItems: "center", justifyContent: "center", paddingHorizontal: 18, flex: 1 },
  primaryButtonText: { color: COLORS.white, fontWeight: "700", fontSize: 15 },
  disabledButton: { opacity: 0.48 },
  buttonPressed: { opacity: 0.82 },
  modeSwitch: { marginTop: 19, alignItems: "center", paddingVertical: 5 },
  mutedText: { color: COLORS.muted, fontSize: 13 },
  linkText: { color: COLORS.blue, fontWeight: "700", fontSize: 14 },
  footerText: { color: "#98a2b3", marginTop: 25, fontSize: 12 },
  listHeader: { paddingHorizontal: 20, paddingTop: 14, paddingBottom: 10, backgroundColor: COLORS.white, borderBottomWidth: 1, borderBottomColor: COLORS.line },
  userBlock: { flexDirection: "row", alignItems: "center", gap: 12, paddingBottom: 18 },
  avatar: { width: 43, height: 43, borderRadius: 15, backgroundColor: COLORS.paleBlue, alignItems: "center", justifyContent: "center" },
  avatarText: { color: COLORS.blue, fontSize: 18, fontWeight: "800" },
  headerTitle: { color: COLORS.ink, fontSize: 16, fontWeight: "750" },
  connectionRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 4 },
  statusDot: { width: 7, height: 7, borderRadius: 4 },
  statusText: { color: COLORS.muted, fontSize: 11 },
  textButton: { padding: 8 },
  sectionTitleRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingTop: 12, borderTopWidth: 1, borderTopColor: "#f0f2f6" },
  sectionTitle: { color: COLORS.ink, fontSize: 15, fontWeight: "750" },
  countText: { color: COLORS.muted, fontSize: 12 },
  roomList: { paddingHorizontal: 12, paddingVertical: 8 },
  emptyList: { flexGrow: 1, justifyContent: "center" },
  emptyState: { flex: 1, alignItems: "center", justifyContent: "center", padding: 32 },
  emptyEmoji: { fontSize: 33, marginBottom: 12 },
  emptyTitle: { color: COLORS.ink, fontSize: 17, fontWeight: "750", marginBottom: 6 },
  roomRow: { flexDirection: "row", alignItems: "center", paddingHorizontal: 10, paddingVertical: 13, borderRadius: 15, gap: 12 },
  pressed: { backgroundColor: "#edf1f8" },
  roomAvatar: { width: 49, height: 49, borderRadius: 17, backgroundColor: "#e9edfa", alignItems: "center", justifyContent: "center" },
  roomAvatarText: { color: "#5c6eae", fontSize: 17, fontWeight: "750" },
  groupAvatar: { backgroundColor: "#e5f4ed" },
  groupAvatarText: { color: COLORS.green },
  roomCopy: { flex: 1, borderBottomWidth: 1, borderBottomColor: "#e9edf3", paddingBottom: 13, paddingTop: 1 },
  roomTitleRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  roomTitle: { color: COLORS.ink, fontWeight: "700", fontSize: 15, flex: 1 },
  roomSubtitle: { color: COLORS.muted, fontSize: 12, marginTop: 5 },
  unreadBadge: { minWidth: 21, height: 21, paddingHorizontal: 6, borderRadius: 11, backgroundColor: COLORS.blue, alignItems: "center", justifyContent: "center" },
  unreadText: { color: COLORS.white, fontSize: 11, fontWeight: "750" },
  chevron: { color: "#a5afbd", fontSize: 24, marginTop: -4 },
  bottomBar: { padding: 16, paddingBottom: Platform.OS === "ios" ? 16 : 20, backgroundColor: COLORS.white, borderTopWidth: 1, borderTopColor: COLORS.line },
  chatHeader: { minHeight: 65, flexDirection: "row", alignItems: "center", paddingHorizontal: 14, backgroundColor: COLORS.white, borderBottomWidth: 1, borderBottomColor: COLORS.line, gap: 8 },
  backButton: { width: 38, height: 42, justifyContent: "center" },
  backText: { color: COLORS.blue, fontSize: 37, lineHeight: 40 },
  chatHeaderCopy: { flex: 1 },
  subheaderText: { color: COLORS.muted, fontSize: 11, marginTop: 4 },
  addButton: { paddingHorizontal: 10, paddingVertical: 8 },
  messageList: { flexGrow: 1, justifyContent: "flex-end", padding: 16, gap: 7 },
  bubbleGroup: { maxWidth: "85%", marginTop: 5 },
  mineGroup: { alignSelf: "flex-end", alignItems: "flex-end" },
  theirGroup: { alignSelf: "flex-start", alignItems: "flex-start" },
  senderLine: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 5, paddingHorizontal: 4 },
  presenceDot: { width: 7, height: 7, borderRadius: 4 },
  senderName: { color: COLORS.muted, fontSize: 11, fontWeight: "600" },
  bubble: { borderRadius: 17, paddingHorizontal: 13, paddingVertical: 10 },
  myBubble: { backgroundColor: COLORS.blue, borderBottomRightRadius: 5 },
  theirBubble: { backgroundColor: COLORS.white, borderWidth: 1, borderColor: COLORS.line, borderBottomLeftRadius: 5 },
  pendingBubble: { opacity: 0.62 },
  bubbleText: { color: COLORS.ink, fontSize: 15, lineHeight: 21 },
  myBubbleText: { color: COLORS.white },
  timeText: { color: "#9aa4b3", fontSize: 10, marginTop: 4, paddingHorizontal: 3 },
  typingBox: { minHeight: 22, justifyContent: "center", paddingHorizontal: 18 },
  typingText: { color: COLORS.muted, fontSize: 11 },
  composerRow: { flexDirection: "row", alignItems: "flex-end", gap: 9, paddingHorizontal: 13, paddingVertical: 10, backgroundColor: COLORS.white, borderTopWidth: 1, borderTopColor: COLORS.line },
  composerInput: { flex: 1, maxHeight: 110, minHeight: 45, borderWidth: 1, borderColor: COLORS.line, backgroundColor: "#f8f9fc", borderRadius: 15, paddingHorizontal: 14, paddingTop: 12, paddingBottom: 10, color: COLORS.ink, fontSize: 15 },
  sendButton: { width: 44, height: 44, borderRadius: 15, alignItems: "center", justifyContent: "center", backgroundColor: COLORS.blue },
  sendButtonText: { color: COLORS.white, fontSize: 25, fontWeight: "700", marginTop: -3 },
  errorBanner: { position: "absolute", left: 12, right: 12, bottom: 86, backgroundColor: COLORS.red, borderRadius: 12, padding: 12, elevation: 5 },
  errorBannerText: { color: COLORS.white, fontSize: 13, fontWeight: "600", textAlign: "center" },
  modalBackdrop: { flex: 1, backgroundColor: "rgba(19, 28, 45, 0.38)", alignItems: "center", justifyContent: "center", padding: 22 },
  modalCard: { width: "100%", maxWidth: 440, backgroundColor: COLORS.white, borderRadius: 20, padding: 20 },
  modalHint: { color: COLORS.muted, fontSize: 13, lineHeight: 19, marginTop: -10, marginBottom: 16 },
  modalSecondInput: { marginTop: 10 },
  modalActions: { flexDirection: "row", gap: 10, marginTop: 18, alignItems: "center" },
  cancelButton: { minHeight: 48, paddingHorizontal: 12, justifyContent: "center" },
  cancelText: { color: COLORS.muted, fontWeight: "650" },
});
