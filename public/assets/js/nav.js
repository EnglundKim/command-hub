/* Populates the shared header with the logged-in officer's name, a Logout
   link, and an Admin link (Regimental Command only). Runs on every gated page. */
(async function initNav() {
  const nav = document.querySelector(".site-nav");
  if (!nav) return;

  let me;
  try {
    me = await apiFetch("/api/me");
  } catch {
    return; // not logged in — leave nav as-is (shouldn't normally happen, page is server-gated)
  }

  if (me.tier === "regimental_command" && !nav.querySelector('[data-nav="admin"]')) {
    const li = document.createElement("li");
    const a = document.createElement("a");
    a.href = "admin.html";
    a.textContent = "Admin";
    a.dataset.nav = "admin";
    if (location.pathname.endsWith("admin.html")) a.setAttribute("aria-current", "page");
    li.appendChild(a);
    nav.appendChild(li);
  }

  const li = document.createElement("li");
  const whoami = document.createElement("span");
  whoami.textContent = me.username;
  whoami.style.color = "var(--color-gold)";
  whoami.style.fontFamily = "var(--font-display)";
  whoami.style.fontSize = "var(--fs-sm)";
  whoami.style.textTransform = "uppercase";
  whoami.style.letterSpacing = "0.08em";
  li.appendChild(whoami);
  nav.appendChild(li);

  const logoutLi = document.createElement("li");
  const logoutLink = document.createElement("a");
  logoutLink.href = "#";
  logoutLink.textContent = "Logout";
  logoutLink.addEventListener("click", async (e) => {
    e.preventDefault();
    await apiFetch("/api/logout", { method: "POST" });
    location.href = "login.html";
  });
  logoutLi.appendChild(logoutLink);
  nav.appendChild(logoutLi);
})();
