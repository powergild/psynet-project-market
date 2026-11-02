import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "데이터 박스",
  description: "축을 교차시키면 AI가 셀을 채운다. 내 관점으로 만드는 스포츠 데이터 격자.",
};

// 모바일 웹이 주 사용 환경이다. 확대 방지하지 않고(접근성), 노치 영역까지 쓴다.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#14202A",
};

/** 비상업 고지. 호스팅(Vercel Hobby)이 비상업·개인 용도만 허용하므로,
 *  판매·결제·광고가 없다는 사실을 화면에 드러내 둔다. 결제 연동을 붙이려면
 *  여기부터 지워야 하고, 그때는 호스팅 플랜도 같이 올려야 한다. */
function Footer() {
  return (
    <footer
      style={{
        padding: "28px 16px calc(28px + env(safe-area-inset-bottom))",
        textAlign: "center",
        fontSize: 11,
        lineHeight: 1.7,
        color: "var(--ink-soft)",
      }}
    >
      개인 취미로 만드는 비상업 프로젝트입니다.
      <br />
      상품 판매 · 결제 · 광고가 없습니다.
    </footer>
  );
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>
        {children}
        <Footer />
      </body>
    </html>
  );
}
