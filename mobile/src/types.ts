export type User = { id: string; username: string };
export type Session = { token: string; user: User };

export type Message = {
  id: string;
  roomId: string;
  seq: number;
  clientMsgId: string;
  senderId: string;
  senderName: string;
  body: string;
  createdAt: string;
};

export type ChatMessage = Message | (Omit<Message, "id" | "seq" | "createdAt"> & { pending: true });

export type RoomSummary = {
  id: string;
  type: "dm" | "group";
  name: string | null;
  members: string;
  lastSeq: number;
  unread: number;
};

export type ConnectionStatus = "connecting" | "online" | "reconnecting";

export type ClientEvent =
  | { type: "message.send"; roomId: string; clientMsgId: string; body: string }
  | { type: "typing"; roomId: string; isTyping: boolean }
  | { type: "read"; roomId: string; seq: number }
  | { type: "ping" };

export type ServerEvent =
  | { type: "ready"; userId: string; online: string[] }
  | { type: "pong" }
  | { type: "message.ack"; clientMsgId: string; message: Message }
  | { type: "message.new"; message: Message }
  | { type: "typing"; roomId: string; userId: string; isTyping: boolean }
  | { type: "read"; roomId: string; userId: string; seq: number }
  | { type: "presence"; userId: string; status: "online" | "offline" }
  | { type: "room.joined"; roomId: string }
  | { type: "error"; code: string; message?: string; clientMsgId?: string };
