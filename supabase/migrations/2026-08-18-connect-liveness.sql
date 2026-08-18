-- ============================================================
-- connect 매칭: 실시간 접속자만 매칭되도록 (유령 방어)
-- 적용: Supabase 대시보드 → SQL Editor 에 이 파일 전체를 붙여넣고 Run.
--   (또는  node scripts/apply-connect-liveness.mjs  — SUPABASE_DB_URL 필요, 아래 스크립트 참고)
-- 멱등(CREATE OR REPLACE) — 여러 번 실행해도 안전.
--
-- 원리: 프론트가 2.5초마다 /api/connect/queue 를 폴링하며 joined_at 을 now() 로 갱신 → 생존신호.
--       12초(≈폴링 5회) 초과로 미갱신된 항목은 이탈(탭 종료·모바일 백그라운드·절전 등)로 간주해
--       매칭 대상에서 제외하고 큐에서 정리한다.
-- ============================================================

create or replace function connect_match_or_queue(p_phone text, p_name text)
returns bigint as $$
declare
  v_partner record;
  v_room_id bigint;
begin
  -- 유령 정리: 최근 12초 내 폴링(=생존신호) 없는 대기열 항목 제거.
  delete from connect_queue where joined_at < now() - interval '12 seconds';

  -- 이미 활성 방에 있으면 그 방 반환 (새로고침/재진입 대응)
  select id into v_room_id from connect_rooms
    where status = 'active'
      and (participant_a_phone = p_phone or participant_b_phone = p_phone)
    limit 1;
  if v_room_id is not null then
    return v_room_id;
  end if;

  -- 대기열에서 상대 탐색 — 최근 12초 내 폴링한 '실시간 접속자'만
  select * into v_partner from connect_queue
    where phone <> p_phone
      and joined_at > now() - interval '12 seconds'
    order by joined_at
    limit 1
    for update skip locked;

  if v_partner is not null then
    delete from connect_queue where phone = v_partner.phone;
    delete from connect_queue where phone = p_phone;
    insert into connect_rooms (participant_a_phone, participant_a_name, participant_b_phone, participant_b_name)
      values (p_phone, p_name, v_partner.phone, v_partner.name)
      returning id into v_room_id;
    return v_room_id;
  end if;

  -- 상대 없으면 대기열 등록(갱신) — joined_at = 생존 시각
  insert into connect_queue (phone, name) values (p_phone, p_name)
    on conflict (phone) do update set joined_at = now(), name = excluded.name;
  return null;
end;
$$ language plpgsql;

-- 지금 쌓여 있을 수 있는 유령 즉시 청소(1회성, 선택).
delete from connect_queue where joined_at < now() - interval '12 seconds';
