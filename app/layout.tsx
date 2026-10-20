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

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
