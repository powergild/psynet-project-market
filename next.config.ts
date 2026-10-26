import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 어느 서버에서든 그대로 띄울 수 있게 자립형 번들을 만든다.
  //   node .next/standalone/server.js
  // Vercel에서는 무시되므로 켜둬도 손해가 없고, 회사 서버·다른 호스팅으로
  // 옮길 때 추가 설정이 필요 없어진다.
  // Netlify·Cloudflare 같은 어댑터는 자체 빌드를 쓰므로 standalone과 충돌한다.
  // 필요할 때만 켜다: STANDALONE=1 npm run build
  ...(process.env.STANDALONE === "1" ? { output: "standalone" as const } : {}),
};

export default nextConfig;
