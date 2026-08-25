import LandingDemo from "@/components/LandingDemo";
import { fetchProjects } from "@/lib/projectsDb";

// 구인 중 = 형성/개발 단계 + 모집중. /api/recruiting과 동일 기준.
const RECRUITING_STATUS = new Set(["기획", "예정", "개발", "모집중"]);

// 외부 유입 캠페인(커뮤니티·광고 등)에서 ?ref=... 로 도착하면 #2 히어로("네 회사가 아니어도 돼")를,
// 그 외 일반 방문은 기본 #1 히어로를 노출. (카피 전략: #1 메인 유지 + #2 캠페인 병행)
export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const isCampaign = typeof params.ref === "string" && params.ref.length > 0;
  const recruitingCount = (await fetchProjects()).filter((p) => RECRUITING_STATUS.has(p.status)).length;

  return (
    <main className="landing">
      <div className="eyebrow">PSYNET · PROJECT MARKET</div>
      {isCampaign ? (
        <>
          <h1 className="landing-h1">
            네 회사가 <b>아니어도</b> 돼
          </h1>
          <p className="sub" style={{ marginTop: -8 }}>
            만들면 투자, 참여하면 성과금 — 지금 <b>{recruitingCount}개</b> 프로젝트가 사람 구하는 중.
          </p>
        </>
      ) : (
        <h1 className="landing-h1">
          만들면 <b>투자받고</b>, 참여하면 <b>성과금</b>
        </h1>
      )}
      <LandingDemo />
      <a href={isCampaign ? "/projects?recruiting=1" : "/start"} id="demo-start-btn">
        {isCampaign ? "구인 중 프로젝트 보기 →" : "참여하기 →"}
      </a>
    </main>
  );
}
