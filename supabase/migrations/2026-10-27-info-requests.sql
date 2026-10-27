-- 정보 요청 — 2026-10-27
-- Supabase SQL Editor에서 실행.
--
-- 모르는 대상의 칸은 "—"로 두고, 유저가 그 칸에서 정보를 요청할 수 있다.
-- 요청이 쌓이면 "어떤 선수·팀의 데이터를 먼저 붙여야 하는가"가 데이터가 된다.
-- 지금은 AI가 모르는 것이지만, 이 목록이 곧 LIVE스코어 연동의 우선순위가 된다.

create table if not exists info_requests (
  id          bigserial primary key,
  condition   text not null default '',
  row_axis    text not null,
  col_axis    text not null,
  match_id    text,
  requests    int  not null default 1,          -- 같은 칸을 여러 번 요청하면 누적
  resolved    boolean not null default false,   -- 데이터가 붙어 값이 나오게 되면 true
  first_at    timestamptz not null default now(),
  last_at     timestamptz not null default now(),
  unique (condition, row_axis, col_axis)
);

-- 많이 요청된 것부터 본다.
create index if not exists info_requests_hot_idx
  on info_requests (resolved, requests desc, last_at desc);

alter table info_requests enable row level security;
