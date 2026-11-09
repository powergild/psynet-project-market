-- 피벗 전 서비스(PROJECT MARKET + 커넥트 채팅)의 테이블을 떨어뜨린다.
--
-- 2026-10-20에 서비스를 데이터 박스로 바꾸면서 코드는 지웠지만 테이블은
-- "건드리지 않고 방치"하기로 했다. 2026-11-09에 방침을 바꾼다 — 사용자 결정.
--
-- 바꾼 이유: `users`에 실명·전화번호·이메일이, `projects`에 PM 전화번호가,
-- `admin_access_log`에 접근 IP가 들어 있었다. 읽는 코드(`lib/admin.ts`·`lib/auth.ts`)는
-- 같은 날 지웠지만, 쓰이지 않는 PII를 운영 DB에 남겨 둘 이유가 없다.
--
-- 행은 이미 REST로 비웠다(전 테이블 0행 확인). 이 파일은 테이블 자체를 없앤다.
-- **백업은 남기지 않았다** — 사용자가 백업 없이 삭제를 택했다. 되돌릴 수 없다.
--
-- 적용: Supabase 대시보드 → SQL Editor에 붙여넣고 실행.
--
-- ⚠ 데이터 박스 테이블은 건드리지 않는다:
--      boxes · cell_cache · glow_records · info_requests · piece_formulas
--   `boxes`에도 `owner_phone` 컬럼이 있지만 그건 데이터 박스 쪽 테이블이고
--   (`lib/boxDb.ts`가 쓴다) 값은 `anon`이다. 이름이 비슷하니 혼동하지 말 것.
--
-- ⚠ `axis_catalog` · `box_axes` · `box_cells` · `cell_formulas`도 참조가 0이지만
--   **여기서 지우지 않는다.** 그건 옛 서비스가 아니라 현재 제품의 10-20
--   마이그레이션이 만든 것으로, 박스를 localStorage에서 Supabase로 옮길 때
--   (SCRUM-180) 쓸 자리다. 그 결정이 나기 전에는 남겨 둔다.

begin;

-- 참조하는 쪽부터. cascade는 남아 있을 수 있는 외래키·뷰·정책을 함께 떨어뜨린다.
drop table if exists connect_messages      cascade;
drop table if exists connect_likes         cascade;
drop table if exists connect_rooms         cascade;
drop table if exists connect_projects      cascade;
drop table if exists connect_liveness      cascade;
drop table if exists project_participants  cascade;
drop table if exists participants          cascade;
drop table if exists applications          cascade;
drop table if exists projects              cascade;
drop table if exists users                 cascade;

-- /admin 접근 감시. 그 화면이 2026-11-09에 사라져 함께 간다.
drop table if exists admin_access_log      cascade;
drop table if exists admin_alert_state     cascade;

commit;

-- 확인 — 아래 조회가 0행이어야 한다.
--
--   select table_name from information_schema.tables
--    where table_schema = 'public'
--      and table_name in ('users','projects','applications','participants',
--                         'project_participants','connect_rooms','connect_messages',
--                         'connect_likes','connect_projects','connect_liveness',
--                         'admin_access_log','admin_alert_state');
--
-- 그리고 아래는 5행이 남아 있어야 한다(데이터 박스가 멀쩡한지).
--
--   select table_name from information_schema.tables
--    where table_schema = 'public'
--      and table_name in ('boxes','cell_cache','glow_records','info_requests','piece_formulas');
