import {
  supabase,
  type ConnectLikeRow,
  type ConnectMessageRow,
  type ConnectProjectRow,
  type ConnectRoomRow,
} from "@/lib/supabase";

export async function getConnectStats(): Promise<{ waiting: number; activeRooms: number }> {
  // "대기 중" 수도 실시간 접속자만 — 최근 12초 내 폴링한 큐 항목만 카운트(유령 제외).
  const fresh = new Date(Date.now() - 12_000).toISOString();
  const [{ count: waiting }, { count: activeRooms }] = await Promise.all([
    supabase.from("connect_queue").select("*", { count: "exact", head: true }).gt("joined_at", fresh),
    supabase.from("connect_rooms").select("*", { count: "exact", head: true }).eq("status", "active"),
  ]);
  return { waiting: waiting ?? 0, activeRooms: activeRooms ?? 0 };
}

/** 매칭 큐 진입/폴링. 상대가 대기 중이면 즉시 매칭해 room_id 반환, 없으면 null(대기중). */
export async function matchOrQueue(phone: string, name: string): Promise<number | null> {
  const { data, error } = await supabase.rpc("connect_match_or_queue", {
    p_phone: phone,
    p_name: name,
  });
  if (error) throw new Error(error.message);
  return (data as number | null) ?? null;
}

export async function leaveQueue(phone: string): Promise<void> {
  await supabase.from("connect_queue").delete().eq("phone", phone);
}

export async function getRoom(roomId: number): Promise<ConnectRoomRow | null> {
  const { data, error } = await supabase
    .from("connect_rooms")
    .select("*")
    .eq("id", roomId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as ConnectRoomRow) ?? null;
}

export function partnerOf(room: ConnectRoomRow, phone: string): { phone: string; name: string } {
  return room.participant_a_phone === phone
    ? { phone: room.participant_b_phone, name: room.participant_b_name }
    : { phone: room.participant_a_phone, name: room.participant_a_name };
}

export async function listMessages(roomId: number): Promise<ConnectMessageRow[]> {
  const { data, error } = await supabase
    .from("connect_messages")
    .select("*")
    .eq("room_id", roomId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as ConnectMessageRow[];
}

export async function sendMessage(
  roomId: number,
  senderPhone: string,
  senderName: string,
  content: string
): Promise<void> {
  const { error } = await supabase
    .from("connect_messages")
    .insert({ room_id: roomId, sender_phone: senderPhone, sender_name: senderName, content });
  if (error) throw new Error(error.message);
}

/** 방 종료 — 메시지 전부 삭제(영구 로그 없음), 방 상태만 ended로 남김. */
export async function endRoom(roomId: number): Promise<void> {
  await supabase.from("connect_messages").delete().eq("room_id", roomId);
  await supabase
    .from("connect_rooms")
    .update({ status: "ended", ended_at: new Date().toISOString() })
    .eq("id", roomId);
}

export async function likeUser(roomId: number, likerPhone: string, likedPhone: string): Promise<boolean> {
  await supabase
    .from("connect_likes")
    .upsert({ room_id: roomId, liker_phone: likerPhone, liked_phone: likedPhone }, { onConflict: "room_id,liker_phone" });

  const { data, error } = await supabase
    .from("connect_likes")
    .select("*")
    .eq("room_id", roomId);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as ConnectLikeRow[];
  return rows.some((r) => r.liker_phone === likedPhone && r.liked_phone === likerPhone);
}

export async function createConnectProject(
  roomId: number,
  title: string,
  summary: string,
  pmPhone: string,
  pmName: string,
  partnerPhone: string,
  partnerName: string
): Promise<ConnectProjectRow> {
  const { data, error } = await supabase
    .from("connect_projects")
    .insert({
      room_id: roomId,
      title,
      summary,
      pm_phone: pmPhone,
      pm_name: pmName,
      partner_phone: partnerPhone,
      partner_name: partnerName,
    })
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return data as ConnectProjectRow;
}

export async function listConnectProjects(): Promise<ConnectProjectRow[]> {
  const { data, error } = await supabase
    .from("connect_projects")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as ConnectProjectRow[];
}
