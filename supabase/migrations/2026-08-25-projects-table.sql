-- 프로젝트 카탈로그를 DB로 이관 (2026-08-25 실서비스 전환)
-- 기존 data/projects.json(빌드타임 정적)은 비웠고, 이제 사용자가 터미널에서 직접 등록한다.
-- Supabase SQL Editor에서 그대로 실행할 것. git push/Vercel 배포로는 반영되지 않음.
create table if not exists projects (
  id               text primary key,
  title            text not null,
  pm               text not null default '',   -- 화면 표시용(마스킹된 성**). 실소유자는 pm_phone로 식별.
  pm_phone         text,                        -- 등록자(=PM) 식별자. 사용자 등록분만 값 있음.
  max_participants int,
  required_skills  text[] not null default '{}',
  status           text not null default '모집중',
  summary          text not null default '',
  created_at       timestamptz not null default now()
);

create index if not exists projects_created_idx  on projects (created_at desc);
create index if not exists projects_pm_phone_idx on projects (pm_phone);

-- 서버(API route)만 service role key로 접근. 익명 클라이언트 직접접근 차단.
alter table projects enable row level security;
