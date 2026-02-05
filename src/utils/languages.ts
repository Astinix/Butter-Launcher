// src/utils/languages.ts

export const LANGUAGES = {
  en: {
    name: "English",
    flag: "🇺🇸",
    ui: {
      settings_title: "SYSTEM SETTINGS",
      play_btn: "PLAY",
      install_btn: "INSTALL",
      update_btn: "UPDATE",
      logout: "LOGOUT",
      nick_placeholder: "Nickname",
      enter: "ENTER",
      searching_updates: "CHECKING...",
      check_updates: "CHECK FOR UPDATES",
    }
  },
  es: {
    name: "Español",
    flag: "🇪🇸",
    ui: {
      settings_title: "AJUSTES DEL SISTEMA",
      play_btn: "JUGAR",
      install_btn: "INSTALAR",
      update_btn: "ACTUALIZAR",
      logout: "CERRAR SESIÓN",
      nick_placeholder: "Apodo",
      enter: "ENTRAR",
      searching_updates: "BUSCANDO...",
      check_updates: "BUSCAR ACTUALIZACIONES",
    }
  }
};

export type LangCode = keyof typeof LANGUAGES;