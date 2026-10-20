-- 데이터 박스 (Data Box) — 2026-10-20 서비스 피봇
-- Supabase SQL Editor에서 그대로 실행. git push / Vercel 배포로는 반영되지 않음.
-- 구 프로젝트 마켓 테이블(projects/applications/connect_* 등)은 건드리지 않는다(미사용 방치).

-- ── 축 카탈로그 ────────────────────────────────────────────
-- scope: global = 어디서나 선택 가능 / match = 경기 상세에서만 (선수 축)
create table if not exists axis_catalog (
  id          bigserial primary key,
  category    text not null,
  name        text not null,
  scope       text not null default 'global',
  use_count   int  not null default 0,
  created_at  timestamptz not null default now(),
  unique (category, name)
);
create index if not exists axis_catalog_use_idx on axis_catalog (use_count desc);

-- ── 박스 ──────────────────────────────────────────────────
create table if not exists boxes (
  id          text primary key,
  owner_phone text not null,              -- users.phone (로그인 식별자)
  name        text not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists boxes_owner_idx on boxes (owner_phone, updated_at desc);

-- ── 축 스택 (행/열) ────────────────────────────────────────
-- 같은 축 이름이어도 대상(ctx)·출처(src)가 다르면 별도 행으로 쌓인다(F-14 축 스택).
-- axis_name NULL = "(빈칸)" — 계산하지 않는다.
create table if not exists box_axes (
  id          text primary key,
  box_id      text not null references boxes(id) on delete cascade,
  kind        text not null check (kind in ('row','col')),
  pos         int  not null,
  axis_name   text,
  ctx         text,                        -- 대상 바인딩 (예: 프랑스·모로코). NULL = 일반 지표
  src         text,                        -- 계산식 출처 핸들(@rainman). NULL = 자작
  created_at  timestamptz not null default now()
);
create index if not exists box_axes_box_idx on box_axes (box_id, kind, pos);

-- ── 박스별 셀 값 ──────────────────────────────────────────
create table if not exists box_cells (
  id           bigserial primary key,
  box_id       text not null references boxes(id) on delete cascade,
  row_axis_id  text not null,
  col_axis_id  text not null,
  value        text not null,              -- "62.4%" | "1.73" | "—"
  computed_at  timestamptz not null default now(),
  unique (box_id, row_axis_id, col_axis_id)
);
create index if not exists box_cells_box_idx on box_cells (box_id);

-- ── 전역 조합 캐시 (F-03 하이브리드 캐싱) ──────────────────
-- 축 조합이 같으면 박스가 달라도 재사용. AI 호출 비용 절감의 핵심.
create table if not exists cell_cache (
  combo_key    text primary key,           -- "행축|대상 :: 열축|대상"
  value        text not null,
  hits         int  not null default 1,
  computed_at  timestamptz not null default now()
);
create index if not exists cell_cache_hits_idx on cell_cache (hits desc);

-- ── 계산식 가중치 (F-23) ──────────────────────────────────
create table if not exists cell_formulas (
  id            bigserial primary key,
  box_id        text not null references boxes(id) on delete cascade,
  row_axis_id   text not null,
  col_axis_id   text not null,
  weights       jsonb not null,            -- {row:1, col:1, recent5:0.5, sample:0.3}
  adjusted_value text,                     -- 조정 후 고정값. NULL = 기본 계산값 사용
  updated_at    timestamptz not null default now(),
  unique (box_id, row_axis_id, col_axis_id)
);

-- ── 발광 기록 = 예측 선언 + 채점 (F-05/F-06) ──────────────
create table if not exists glow_records (
  id            bigserial primary key,
  box_id        text not null references boxes(id) on delete cascade,
  match_id      text not null,
  row_axis_id   text not null,
  col_axis_id   text not null,
  row_axis_name text,
  col_axis_name text,
  value_at_glow text,
  reason        text,                      -- AI가 유효하다고 판단한 근거 1줄
  declared_at   timestamptz not null default now(),
  scored        boolean not null default false,
  hit           boolean,
  scored_at     timestamptz,
  unique (box_id, match_id, row_axis_id, col_axis_id)
);
create index if not exists glow_box_idx   on glow_records (box_id, declared_at desc);
create index if not exists glow_match_idx on glow_records (match_id, scored);

-- 서버(service role)만 접근. 익명 클라이언트 차단.
alter table axis_catalog  enable row level security;
alter table boxes         enable row level security;
alter table box_axes      enable row level security;
alter table box_cells     enable row level security;
alter table cell_cache    enable row level security;
alter table cell_formulas enable row level security;
alter table glow_records  enable row level security;
