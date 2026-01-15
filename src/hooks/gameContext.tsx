import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
} from "react";

type InstallProgress = {
  phase: "download" | "extract";
  percent: number;
  total: number;
  current: number;
};

interface GameContextType {
  gameDir: string | null;
  isInstalled: boolean;
  gameVersion: string | null;
  latestVersion: string | null;
  installing: boolean;
  installProgress: InstallProgress;
  launching: boolean;
  gameLaunched: boolean;
  installGame: () => void;
  launchGame: (username: string) => void;
  checkGameInstallation: (baseDir: string) => void;
}

export const GameContext = createContext<GameContextType | null>(null);

export const GameContextProvider = ({
  children,
}: {
  children: React.ReactNode;
}) => {
  const [gameDir, setGameDir] = useState<string | null>(null);
  const [isInstalled, setIsInstalled] = useState(false);
  const [gameVersion, setGameVersion] = useState<string | null>(null);
  const [latestVersion, setLatestVersion] = useState<string | null>(null);

  const [installing, setInstalling] = useState(false);
  const [installProgress, setInstallProgress] = useState<InstallProgress>({
    phase: "download",
    percent: 0,
    total: 0,
    current: 0,
  });
  const [launching, setLaunching] = useState(false);
  const [gameLaunched, setGameLaunched] = useState(false);

  const installGame = useCallback(() => {
    if (!gameDir) return;
    setInstalling(true);

    window.ipcRenderer.send("init-install", gameDir);

    window.ipcRenderer.once("install-finished", () => {
      setInstalling(false);
      localStorage.setItem("gameVersion", latestVersion || "");
      checkGameInstallation(gameDir);
    });

    window.ipcRenderer.once("install-error", (_, error) => {
      setInstalling(false);
      alert(`Installation failed: ${error}`);
    });
  }, [gameDir, latestVersion]);

  const launchGame = useCallback(
    (username: string) => {
      if (!gameDir || !isInstalled) return;
      setLaunching(true);

      window.ipcRenderer.send("launch-game", gameDir, username);
      window.ipcRenderer.once("launched", () => {
        setLaunching(false);
        setGameLaunched(true);
      });
    },
    [gameDir, isInstalled]
  );

  const checkGameInstallation = (baseDir: string) => {
    const storedGameVersion = localStorage.getItem("gameVersion");
    if (storedGameVersion) setGameVersion(storedGameVersion);
    else setGameVersion(null);

    window.ipcRenderer
      .invoke("check-game-installation", baseDir)
      .then((data) => {
        console.log(data);
        setIsInstalled(data.client && data.server && data.jre);
      });
  };

  const checkLatestVersion = () => {
    const URL = import.meta.env.VITE_DOWNLOADS_API_URL;
    if (!URL) throw new Error("VITE_DOWNLOADS_API_URL is not defined");

    window.ipcRenderer.invoke("fetch:json", URL).then((data) => {
      if (window.config.OS === "win32" && data.releases.windows) {
        setLatestVersion(data.releases.windows.latest.version);
      } else if (window.config.OS === "linux" && data.releases.linux) {
        setLatestVersion(data.releases.linux.latest.version);
      }
    });
  };

  useEffect(() => {
    if (!window.config) return;

    const bounceTimeout = 500;
    let lastUpdateProgress: number;
    window.ipcRenderer.on("install-progress", (_, progress) => {
      if (lastUpdateProgress && Date.now() - lastUpdateProgress < bounceTimeout)
        return;
      lastUpdateProgress = Date.now();

      setInstallProgress(progress);
    });

    (async () => {
      const defaultGameDirectory =
        await window.config.getDefaultGameDirectory();

      setGameDir(defaultGameDirectory);
      checkGameInstallation(defaultGameDirectory);
      checkLatestVersion();
    })();
  }, []);

  return (
    <GameContext.Provider
      value={{
        gameDir,
        isInstalled,
        gameVersion,
        latestVersion,
        installing,
        installProgress,
        launching,
        gameLaunched,
        installGame,
        launchGame,
        checkGameInstallation,
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
