try {
    const raw = localStorage.getItem("hookahSpliterStateV2");
    const st = raw ? JSON.parse(raw) : null;
    const choice = st?.settings?.theme || "system";
    const prefersDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
    const mode = (choice === "dark" || (choice === "system" && prefersDark)) ? "dark" : "light";
    document.documentElement.setAttribute("data-theme", mode);
  } catch (e) {}