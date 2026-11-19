import type { NextConfig } from "next";
import { BASE_PATH } from "./src/lib/base-path";

const config: NextConfig = {
  output: "export",
  basePath: BASE_PATH,
  env: { NEXT_PUBLIC_BASE_PATH: BASE_PATH },
  agentRules: false,
  images: { unoptimized: true },
  poweredByHeader: false,
  experimental: { useTypeScriptCli: false },
};

export default config;
