import React from "react";
import { FolderOpen } from "lucide-react";
import { useGameContext } from "../hooks/gameContext";

const SettingsModal: React.FC<{
  open: boolean;
  onClose: () => void;
  onLogout?: () => void;
}> = ({ open, onClose, onLogout }) => {
  const { gameDir } = useGameContext();

  const handleOpenGameDir = async () => {
    try {
      const dir = gameDir ?? (await window.config.getDefaultGameDirectory());
      await window.config.openFolder(dir);
    } catch (e) {
      console.error("Failed to open game directory", e);
      alert("Failed to open game directory");
    }
  };

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="relative w-full max-w-xs mx-auto rounded-2xl shadow-2xl bg-[#181c24e6] p-6 animate-fade-in border border-[#23293a] flex flex-col items-center">
        <button
          className="absolute top-4 right-4 text-gray-400 hover:text-white text-2xl font-bold"
          onClick={onClose}
          title="Cerrar"
        >
          ×
        </button>
        <h2 className="text-2xl font-extrabold text-white mb-6 text-center tracking-wide drop-shadow">
          SETTINGS
        </h2>
        <div className="w-full space-y-4">
          {/* <div>
            <label className="text-gray-200 text-sm font-semibold mb-1 block">
              Patchline
            </label>
            <select className="w-full mt-1 p-2 rounded bg-[#23293a] text-white border border-[#3b82f6] focus:outline-none">
              <option>release</option>
              <option>snapshot</option>
            </select>
          </div> */}
          <div>
            <label className="text-gray-200 text-sm font-semibold mb-1 block">
              Game Directory
            </label>
            <button
              className="flex items-center gap-2 bg-[#23293a] border border-[#3b82f6] text-white px-4 py-2 rounded hover:bg-[#23293a]/80 transition"
              onClick={handleOpenGameDir}
            >
              Open
              <FolderOpen />
            </button>
          </div>
          <div>
            <label className="text-gray-200 text-sm font-semibold mb-1 block">
              Launcher Version
            </label>
            <div className="text-xs text-gray-400 font-mono">
              ButterLauncher_2026.01.16
            </div>
          </div>
          {/* <div>
            <label className="text-gray-200 text-sm font-semibold mb-1 block">
              Previous Version{" "}
              <span className="text-xs text-gray-400 font-normal">
                (Not available)
              </span>
            </label>
            <button className="w-full bg-[#23293a] text-gray-400 px-4 py-2 rounded mt-1 cursor-not-allowed" disabled>
              LAUNCH
            </button>
          </div> */}
          <button className="w-full border border-[#3b82f6] text-[#3b82f6] font-bold py-2 rounded-lg hover:bg-[#23293a]/80 transition">
            CHECK FOR UPDATES
          </button>
          {/* <button className="w-full border border-red-500 text-red-400 font-bold py-2 rounded-lg hover:bg-red-900/60 transition">
            UNINSTALL...
          </button> */}
          {onLogout && (
            <button
              className="w-full border-none text-white font-bold py-2 rounded-lg bg-linear-to-r from-[#3b82f6] to-[#60a5fa] hover:from-[#2563eb] hover:to-[#3b82f6] transition mt-2 shadow-lg"
              onClick={onLogout}
            >
              LOGOUT
            </button>
          )}

          <div className="pt-4 mt-2 border-t border-[#23293a] w-full text-center">
            <span className="text-[10px] uppercase tracking-widest text-gray-500 font-bold">Credits</span>
            <div className="mt-2 space-y-1">
              <p className="text-xs text-gray-400">Online Fix: <span className="text-blue-400">vZyle</span></p>
              <p className="text-xs text-gray-400">System Launcher: <span className="text-blue-400">Fitzxel</span></p>
              <p className="text-xs text-gray-400">Design Launcher: <span className="text-blue-400">primeisonline</span></p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SettingsModal;