import Terminal from "@/components/Terminal";
import { fetchProjects } from "@/lib/projectsDb";

const RECRUITING_STATUS = new Set(["기획", "예정", "개발", "모집중"]);

export default async function StartPage() {
  const recruitingCount = (await fetchProjects()).filter((p) => RECRUITING_STATUS.has(p.status)).length;
  return (
    <main>
      <section className="hero">
        <div className="eyebrow">PSYNET · PROJECT MARKET</div>
        <h1>
          프로젝트. 찾지말고 <b>물어보세요</b>
        </h1>
        <a
          href="/projects?recruiting=1"
          style={{
            display: "block",
            margin: "0 auto 4px",
            maxWidth: 640,
            background: "#12251a",
            border: "1px solid #2f6b3a",
            borderRadius: 8,
            padding: "10px 14px",
            color: "#7CFF9B",
            fontSize: 14,
            textDecoration: "none",
          }}
        >
          🟢 지금 <b>{recruitingCount}개</b> 프로젝트가 사람 구하는 중 — 참여하면 성과금. 합류 가능한 프로젝트 보기 →
        </a>
      </section>
      <Terminal />
      <p
        style={{
          textAlign: "center",
          margin: "30px auto 8px",
          maxWidth: 640,
          fontSize: 13,
          lineHeight: 1.7,
          color: "#8a94a6",
        }}
      >
        연락처가 바뀌었거나 다시 연락받고 싶으면{" "}
        <a href="mailto:junholee940930@psynet.co.kr" style={{ color: "#7CFF9B", textDecoration: "none" }}>
          junholee940930@psynet.co.kr
        </a>{" "}
        로 메일 주세요.
      </p>
    </main>
  );
}
