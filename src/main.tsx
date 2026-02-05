import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

import { GameContextProvider } from "./hooks/gameContext";
import { UserContextProvider } from "./hooks/userContext";
import { LanguageProvider } from "./hooks/useLanguage";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <LanguageProvider>
      <GameContextProvider>
        <UserContextProvider>
          <App />
        </UserContextProvider>
      </GameContextProvider>
    </LanguageProvider>
  </React.StrictMode>
);