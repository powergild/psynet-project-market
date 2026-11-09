import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// 지연 초기화 — 빌드 타임(Next.js route 수집 단계)에는 env가 없을 수 있으므로
// 모듈 로드 시점이 아니라 실제 요청 처리 시점에만 생성/검증한다.
let client: SupabaseClient | null = null;

function getClient(): SupabaseClient {
  if (client) return client;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 환경변수가 설정되지 않았습니다.");
  }
  // 서버(API route) 전용 클라이언트. service role key — 클라이언트 번들에 노출 금지.
  client = createClient(url, key, { auth: { persistSession: false } });
  return client;
}

export const supabase = new Proxy({} as SupabaseClient, {
  get(_target, prop, receiver) {
    return Reflect.get(getClient(), prop, receiver);
  },
});

// 테이블 행 타입은 여기 두지 않는다.
// 2026-11-09까지 ApplicationRow·UserRow·ConnectRoomRow·ConnectMessageRow·
// ConnectLikeRow·ConnectProjectRow·ProjectParticipantRow 일곱 개가 남아 있었는데
// 전부 피벗 전 「프로젝트 마켓 + 커넥트 채팅」의 것이고 참조가 0이었다.
// 데이터 박스의 행 타입은 각 모듈(boxDb·market·wallet·pieces)이 자기 것만 갖는다.
