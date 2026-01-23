/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_NEWS_URL?: string;
}

type VersionType = "release" | "pre-release";

type GameVersion = {
  url: string;
  type: VersionType;
  build_index: number;
  build_name: string;
  isLatest?: boolean;
  patch_url?: string;
  patch_hash?: string;
  original_url?: string;
  patch_note?: string;
  installed?: boolean;
};

type VersionDetails = {
  name: string;
  url?: string;
  original?: string;
  hash?: string;
  patch_note?: string;
};

type VersionDetailsList = {
  windows: Record<string, VersionDetails>;
  linux: Record<string, VersionDetails>;
  darwin: Record<string, VersionDetails>;
};

type VersionDetailsRoot = {
  last_updated: string;
  latest_release_id: number;
  latest_prerelease_id: number;
  versions: VersionDetailsList;
  pre_releases: VersionDetailsList;
};

type InstallProgress = {
  phase: string;
  percent: number;
  total?: number;
  current?: number;
};
