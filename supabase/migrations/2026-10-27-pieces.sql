-- 스포츠조각 성장 루프 — 2026-10-27
-- Supabase SQL Editor에서 그대로 실행. git push / Vercel 배포로는 반영되지 않는다.
--
-- 셀 하나가 곧 조각이다: (조건 + 행 축 + 열 축).
-- 경기 결과로 채점되면서 적중과 경험치가 **셀 단위로** 누적되고, 그 성적이 마켓 가격이 된다.

-- ── 발광 기록에 조건과 경험치를 더한다 ────────────────────
-- 조건이 없으면 '' (평상시). 같은 행×열이라도 조건이 다르면 다른 조각이다 —
-- "비 올 때의 음바페"와 "평상시의 음바페"는 서로 다른 주장이기 때문이다.
alter table glow_records add column if not exists condition text not null default '';
alter table glow_records add column if not exists exp        int  not null default 0;

-- 조각 단위 집계용. (행, 열, 조건)으로 모아 읽는다.
create index if not exists glow_piece_idx
  on glow_records (row_axis_name, col_axis_name, condition, scored);

-- ── 조각 계산식 ───────────────────────────────────────────
-- 기존 cell_formulas는 box_id + 축 **id**로 묶여 있다. 축 id는 박스를 다시 만들 때마다
-- 바뀌므로 성적을 누적할 식별자가 못 된다. 계산식은 **이름 + 조건**으로 붙잡는다.
create table if not exists piece_formulas (
  id          bigserial primary key,
  owner       text not null,                 -- 소유자(현재는 기기/익명 식별자)
  condition   text not null default '',
  row_axis    text not null,
  col_axis    text not null,
  weights     jsonb not null,                -- {"행축":55,"열축":45,"최근 5경기 가중":30,"표본 보정":20}
  base_value  text,                          -- 조정 전 원래 값
  updated_at  timestamptz not null default now(),
  unique (owner, condition, row_axis, col_axis)
);
create index if not exists piece_formulas_owner_idx on piece_formulas (owner, updated_at desc);

-- 서버(service role)만 접근.
alter table piece_formulas enable row level security;
