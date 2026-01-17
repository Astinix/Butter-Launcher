import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
} from "react";
import {
  getGameVersions,
  getInstalledGameVersions,
  saveInstalledGameVersion,
} from "../utils/game";

interface GameContextType {
  gameDir: string | null;
  availableVersions: GameVersion[];
  selectedVersion: number;
  installing: boolean;
  installProgress: InstallProgress;
  launching: boolean;
  gameLaunched: boolean;
  installGame: (version: GameVersion) => void;
  launchGame: (version: GameVersion, username: string) => void;
}

export const GameContext = createContext<GameContextType | null>(null);

export const GameContextProvider = ({
  children,
}: {
  children: React.ReactNode;
}) => {
  const [gameDir, setGameDir] = useState<string | null>(null);
  const [availableVersions, setAvailableVersions] = useState<GameVersion[]>([]);
  const [selectedVersion, setSelectedVersion] = useState<number>(0);

  const [installing, setInstalling] = useState(false);
  const [installProgress, setInstallProgress] = useState<InstallProgress>({
    phase: "download",
    percent: 0,
    total: 0,
    current: 0,
  });
  const [launching, setLaunching] = useState(false);
  const [gameLaunched, setGameLaunched] = useState(false);

  const installGame = useCallback(
    (version: GameVersion) => {
      if (!gameDir) return;

      window.ipcRenderer.send("install-game", gameDir, version);
    },
    [gameDir]
  );

  const launchGame = useCallback(
    (version: GameVersion, username: string) => {
      if (!gameDir || !version.installed) return;
      setLaunching(true);

      window.ipcRenderer.send("launch-game", gameDir, version, username);
      window.ipcRenderer.once("launched", () => {
        setLaunching(false);
        setGameLaunched(true);
      });
      window.ipcRenderer.once("launch-finished", () => {
        setLaunching(false);
        setGameLaunched(false);
      });
      window.ipcRenderer.once("launch-error", () => {
        setLaunching(false);
        setGameLaunched(false);
      });
    },
    [gameDir]
  );

  const getAvailableVersions = async () => {
    const local = getInstalledGameVersions();
    setAvailableVersions(local); // set available from installed while loading remote

    let remote = await getGameVersions();
    if (remote.length === 0) return;

    remote = remote.map((version) => {
      const installed = local.find(
        (v) => v.build_index === version.build_index
      );
      return {
        ...version,
        installed: !!installed,
      };
    });

    setAvailableVersions(remote);
  };

  useEffect(() => {
    if (!window.config) return;

    const bounceTimeout = 200;
    let lastUpdateProgress: number;
    const lastProgressRef = { current: null as InstallProgress | null };

    window.ipcRenderer.on("install-progress", (_, progress: InstallProgress) => {
      const now = Date.now();
      const last = lastProgressRef.current;

      // Never drop phase changes (this was causing the UI to get stuck on "Downloading...").
      const phaseChanged = !last || last.phase !== progress.phase;
      const allowThrough =
        phaseChanged ||
        progress.percent === -1 ||
        progress.percent === 100 ||
        !lastUpdateProgress ||
        now - lastUpdateProgress >= bounceTimeout;

      if (!allowThrough) return;

      lastUpdateProgress = now;
      lastProgressRef.current = progress;
      setInstallProgress(progress);
    });
    window.ipcRenderer.on("install-started", () => {
      setInstalling(true);
    });
    window.ipcRenderer.on("install-finished", (_, version) => {
      setInstalling(false);
      saveInstalledGameVersion(version);

      // Update in-memory list so the UI immediately switches from "Install" to "Play".
      setAvailableVersions((prev) => {
        const next = prev.map((v) =>
          v.build_index === version.build_index && v.type === version.type
            ? { ...v, installed: true }
            : v
        );

        const idx = next.findIndex(
          (v) => v.build_index === version.build_index && v.type === version.type
        );
        if (idx !== -1) setSelectedVersion(idx);

        return next;
      });
    });
    window.ipcRenderer.on("install-error", (_, error) => {
      setInstalling(false);
      alert(`Installation failed: ${error}`);
    });

    (async () => {
      const defaultGameDirectory =
        await window.config.getDefaultGameDirectory();

      setGameDir(defaultGameDirectory);
    })();

    getAvailableVersions();
  }, []);

  useEffect(() => {
    if (!availableVersions.length) return;
    console.log("availableVersions", availableVersions);

    // Persist selection by build_index, but keep state as an array index.
    const storedBuildIndex = localStorage.getItem("selectedVersionBuildIndex");
    if (storedBuildIndex) {
      const parsed = parseInt(storedBuildIndex, 10);
      if (!Number.isNaN(parsed)) {
        const found = availableVersions.findIndex((v) => v.build_index === parsed);
        if (found !== -1) {
          setSelectedVersion(found);
          return;
        }
      }
    }

    // Default to latest (last in the list)
    setSelectedVersion(availableVersions.length - 1);
  }, [availableVersions]);

  useEffect(() => {
    if (!availableVersions.length) return;
    const selected = availableVersions[selectedVersion];
    if (!selected) return;
    localStorage.setItem("selectedVersionBuildIndex", selected.build_index.toString());
  }, [selectedVersion, availableVersions]);

  return (
    <GameContext.Provider
      value={{
        gameDir,
        availableVersions,
        selectedVersion,
        installing,
        installProgress,
        launching,
        gameLaunched,
        installGame,
        launchGame,
      }}
    >
      {children}
    </GameContext.Provider>
  );
};

export const useGameContext = () => {
  const context = useContext(GameContext);
  if (!context)
    throw new Error("useGameContext must be used within a GameContextProvider");
  return context;
};
