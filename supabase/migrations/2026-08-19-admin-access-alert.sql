-- 관리자 접근 감시 + 이상 징후 알림 (2026-08-19)
-- Supabase SQL Editor에서 그대로 실행할 것. git push / Vercel 배포로는 반영되지 않음.

-- 관리자 인증 이벤트 로그
-- event: 'login_success' | 'login_fail' | 'bad_token'
create table if not exists admin_access_log (
  id          bigserial primary key,
  at          timestamptz not null default now(),
  event       text        not null,
  ip          text,
  user_agent  text,
  path        text
);

create index if not exists admin_access_log_at_idx      on admin_access_log (at desc);
create index if not exists admin_access_log_ip_at_idx   on admin_access_log (ip, at desc);
create index if not exists admin_access_log_evt_at_idx  on admin_access_log (event, at desc);

-- 알림 중복 발송 방지용 상태 (key = '알림종류:IP')
create table if not exists admin_alert_state (
  key          text        primary key,
  last_sent_at timestamptz not null default now()
);

-- service role만 접근 (익명 클라이언트 차단)
alter table admin_access_log  enable row level security;
alter table admin_alert_state enable row level security;

-- 90일 지난 로그 정리용. 필요할 때 수동 실행하거나 pg_cron에 걸어둘 것.
--   delete from admin_access_log where at < now() - interval '90 days';
