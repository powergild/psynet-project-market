-- Supabase SQL Editor에서 실행하세요.

-- [deprecated] 지분 협의 기능 제거로 더 이상 코드에서 쓰지 않음. 데이터 보존을 위해
-- DROP은 하지 않았음 — 정말 필요 없으면 Supabase 대시보드에서 수동으로 지울 것.
create table if not exists negotiations (
  id bigint generated always as identity primary key,
  project_id text not null,
  participant text not null,
  role text not null,
  proposed_equity int not null,
  status text not null default 'proposed',
  created_at timestamptz not null default now()
);

-- 프로젝트 신청. 지분율 없음 — "관심있음/참여할래" 의사표시 + PM 수락/거절만 관리.
create table if not exists applications (
  id bigint generated always as identity primary key,
  project_id text not null,
  applicant text not null,
  role text not null default '참여자',
  message text,
  status text not null default 'pending', -- pending | accepted | rejected
  created_at timestamptz not null default now()
);

create index if not exists applications_project_id_idx on applications (project_id);

-- PM 실명 매핑(비공개). "내 프로젝트에 누가 신청했어?" 조회할 때 로그인한 이름과
-- 대조하는 용도로만 서버 코드에서 조회함 — 절대 공개 API/화면에 그대로 노출하지 말 것
-- (data/projects.json에는 마스킹된 pm만 들어감). 저장소가 public GitHub라 git에는
-- 실명을 못 넣어서 DB에만 둠 — scripts/seed-pm-map.mjs로 채움.
create table if not exists project_pm_map (
  project_id text primary key,
  pm_full_name text not null
);

-- 비밀번호 없는 자가등록형 로그인. phone이 유일 식별자 — 같은 번호로 다시 "로그인"하면
-- 그 계정으로 로그인, 처음 보는 번호면 새 계정 생성. name은 로그인할 때마다 최신값으로 갱신.
-- 인증(SMS 등) 없음 — 이름+전화번호만 알면 그 사람 행세로 로그인 가능한 수준의 낮은 보안.
create table if not exists users (
  id bigint generated always as identity primary key,
  phone text not null unique,
  name text not null,
  email text,
  skills text[] not null default '{}',
  completed_projects text[] not null default '{}',
  created_at timestamptz not null default now(),
  last_login_at timestamptz not null default now()
);

-- 서버(API route)는 service role key로 접근하므로 RLS를 켜도 무방하지만,
-- 이 프로젝트는 서버 경유로만 쓰기/읽기가 일어나므로 기본값(RLS off)으로 둔다.
-- 추후 클라이언트에서 anon key로 직접 접근하게 바뀌면 RLS 정책을 반드시 추가할 것.

-- ============================================================
-- 미토크리에이트 (mitocreate) — 추천제 폐쇄형 랜덤 1:1 매칭 채팅
-- 시드 멤버: 기존 users 전원. 외부인은 초대코드로만 가입, 초반 10명 한정(is_external 카운트로 제한).
-- ============================================================

alter table users add column if not exists is_external boolean not null default false;

-- 초대코드. 관리자(/admin)에서 발급, 1회성. 외부인 가입 시 이 코드로만 users에 편입됨.
create table if not exists invites (
  id bigint generated always as identity primary key,
  code text not null unique,
  created_by text not null default 'admin',
  used_by_phone text,
  used_at timestamptz,
  expires_at timestamptz not null default (now() + interval '14 days'),
  created_at timestamptz not null default now()
);

-- 매칭 대기열. phone당 1건 — 재입장 시 대기 시각만 갱신.
create table if not exists connect_queue (
  phone text primary key,
  name text not null,
  joined_at timestamptz not null default now()
);

-- 1:1 채팅방. 종료되면 메시지는 삭제하고 이 row(참여자 기록 + 상태)만 남긴다 — "대화방은 사라진다"는
-- 메시지 내용 얘기고, 누가 누구랑 매칭됐었는지 자체는 호감표시/프로젝트생성 매칭에 필요해서 남겨둠.
create table if not exists connect_rooms (
  id bigint generated always as identity primary key,
  participant_a_phone text not null,
  participant_a_name text not null,
  participant_b_phone text not null,
  participant_b_name text not null,
  status text not null default 'active', -- active | ended
  created_at timestamptz not null default now(),
  ended_at timestamptz
);

-- 채팅 메시지. 방 종료 시 전부 delete — 영구 로그 없음.
create table if not exists connect_messages (
  id bigint generated always as identity primary key,
  room_id bigint not null references connect_rooms(id) on delete cascade,
  sender_phone text not null,
  sender_name text not null,
  content text not null,
  created_at timestamptz not null default now()
);

create index if not exists connect_messages_room_id_idx on connect_messages (room_id);

-- 대화 종료 후 호감표시. 신고/차단 없음 — 이것만 제공.
create table if not exists connect_likes (
  id bigint generated always as identity primary key,
  room_id bigint not null references connect_rooms(id) on delete cascade,
  liker_phone text not null,
  liked_phone text not null,
  created_at timestamptz not null default now(),
  unique (room_id, liker_phone)
);

-- 호감표시(상호) 후 그 자리에서 바로 만드는 프로젝트. 기존 정적 카탈로그(data/projects.json)와는
-- 별개 — 신청/승인 절차 없이 매칭된 두 사람이 이미 PM+참여자로 확정된 상태로 생성.
create table if not exists connect_projects (
  id bigint generated always as identity primary key,
  room_id bigint not null references connect_rooms(id),
  title text not null,
  summary text,
  pm_phone text not null,
  pm_name text not null,
  partner_phone text not null,
  partner_name text not null,
  created_at timestamptz not null default now()
);

-- 매칭 로직 원자적 처리(동시 요청 레이스 방지) — for update skip locked로 동시성 안전하게 처리.
-- 반환: room_id(매칭 성사 시 방 id, 아니면 null)
create or replace function connect_match_or_queue(p_phone text, p_name text)
returns bigint as $$
declare
  v_partner record;
  v_room_id bigint;
begin
  -- 유령 정리: 최근 12초 내 폴링(=생존신호) 없는 대기열 항목 제거.
  -- 프론트가 2.5초마다 재폴링하며 joined_at 을 now() 로 갱신하므로, 12초 초과면 이탈로 간주.
  -- (탭 강제종료/모바일 백그라운드 등 leave 비콘 미발화 케이스 방어 → 실시간 접속자만 매칭)
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

  -- 상대 없으면 대기열 등록(갱신)
  insert into connect_queue (phone, name) values (p_phone, p_name)
    on conflict (phone) do update set joined_at = now(), name = excluded.name;
  return null;
end;
$$ language plpgsql;

-- ============================================================
-- 프로젝트 참여자 명단. 사람(실명)↔프로젝트 매핑.
-- 미토크리에이트 매칭에서 "호감" 성사 시 상대의 참여 프로젝트 리스트를 보여주는 데 사용.
-- 관리자(/admin)에서 추가/삭제. 실명이 들어가므로(공개 GitHub) 이 테이블은 DB에만 채운다
-- — scripts/seed-participants.mjs(로컬 1회)로 시즌 엑셀에서 시드, 이후 관리자에서 관리.
-- project_id는 data/projects.json의 id와 동일 규칙(prj-2026-2-xxx, 소문자).
-- ============================================================
create table if not exists project_participants (
  id bigint generated always as identity primary key,
  project_id text not null,
  name text not null,
  role text not null default '협업자', -- PM | 협업자
  created_at timestamptz not null default now(),
  unique (project_id, name)
);

create index if not exists project_participants_name_idx on project_participants (name);
create index if not exists project_participants_project_idx on project_participants (project_id);
