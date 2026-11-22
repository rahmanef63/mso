// The standalone integrations page is raw HTML served by a route handler, so it never passes through
// AppearanceProvider. Without this it follows the OS `prefers-color-scheme` and ignores the theme the
// operator picked in the shell: a dark-shell user on a light OS got a light page.
//
// The shell persists its choice in localStorage under "mso:tweaks" as `{ theme: "light"|"dark"|null }`.
// This runs in <head> before first paint so there is no light flash, and it degrades to the OS
// preference when the key is absent, exactly as the shell does.
export const INTEGRATION_THEME_SCRIPT = String.raw`
(function(){
  try{
    var raw=localStorage.getItem("mso:tweaks"),theme=null;
    if(raw){var parsed=JSON.parse(raw);theme=parsed&&parsed.theme}
    if(theme==="light"||theme==="dark")document.documentElement.dataset.theme=theme;
  }catch(_){}
})();
`;
