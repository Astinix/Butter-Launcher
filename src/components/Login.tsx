import React, { useState } from "react";
import butterLoginBg from "../assets/butter-login.jpeg";
import butterLogo from "../assets/butter-logo.png";
import DragBar from "./DragBar";

const Login: React.FC<{ onLogin: (username: string) => void }> = ({
  onLogin,
}) => {
  const [nick, setNick] = useState("");
  const [error, setError] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!nick.trim()) {
      setError("Enter your nickname");
      return;
    }
    if (nick.length < 3) {
      setError("Nickname must be at least 3 characters long");
      return;
    }
    if (nick.length > 16) {
      setError("Nickname must be at most 16 characters long");
      return;
    }
    setError("");
    onLogin(nick.trim());
  };

  return (
    <div className="w-screen h-screen flex bg-black overflow-hidden">
      <div className="fixed top-0 left-0 w-full z-50">
        <DragBar />
      </div>

      <div className="w-[380px] h-full bg-[#0f131a] flex flex-col justify-center px-10 relative">
        <img
          src={butterLogo}
          alt="Logo"
          draggable={false}
          className="
            w-[220px]
            h-auto
            top-[10px]
            left-[74px]
            mb-10
            select-none
            absolute"
        />
        <p className="mb-3 text-gray-400 text-sm text-center">
          Enter your nickname to continue
        </p>
        <form onSubmit={handleSubmit} className="flex flex-col gap-2">
          <input
            type="text"
            placeholder="Nickname"
            value={nick}
            minLength={3}
            maxLength={16}
            onChange={(e) => setNick(e.target.value)}
            className="
              w-full h-11 px-4
              bg-[#1a1f2e]
              text-white
              placeholder-gray-500
              rounded
              focus:outline-none
              focus:ring-2 focus:ring-[#4a90e2]
            "
          />
          {error && <span className="text-red-400 text-xs">{error}</span>}
          <p className="px-2 text-gray-400 text-xs">
            {nick.length}/16 characters
          </p>
          <button
            type="submit"
            className="
              mt-2 h-11 w-full
              bg-[#4a90e2]
              text-white font-semibold
              rounded
              hover:bg-[#5aa0f2]
              transition
            "
          >
            ENTER
          </button>
        </form>
        <div className="absolute bottom-6 left-10 text-xs text-gray-500">
          {`${window.config.BUILD_DATE} V${window.config.VERSION}`}
        </div>
      </div>

      <div
        className="flex-1 h-full bg-cover bg-center"
        style={{ backgroundImage: `url(${butterLoginBg})` }}
      />
    </div>
  );
};

export default Login;
