const state = { user: null, users: [] };
const $ = (id) => document.getElementById(id);
const els = {
  identityLine: $("identityLine"),
  logoutBtn: $("logoutBtn"),
  loginPanel: $("loginPanel"),
  adminPanel: $("adminPanel"),
  authMessage: $("authMessage"),
  loginForm: $("loginForm"),
  loginName: $("loginName"),
  loginPassword: $("loginPassword"),
  userForm: $("userForm"),
  newUsername: $("newUsername"),
  newEmail: $("newEmail"),
  newDisplayName: $("newDisplayName"),
  newPassword: $("newPassword"),
  newGlobalRole: $("newGlobalRole"),
  newDashboardAccess: $("newDashboardAccess"),
  newPmAccess: $("newPmAccess"),
  userList: $("userList"),
  refreshBtn: $("refreshBtn")
};

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { "content-type": "application/json", ...(options.headers || {}) }
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) : {};
  if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
  return body;
}

function showLogin(message = "") {
  state.user = null;
  els.identityLine.textContent = "Not signed in";
  els.authMessage.textContent = message;
  els.loginPanel.hidden = false;
  els.adminPanel.hidden = true;
  els.logoutBtn.hidden = true;
}

async function showAdmin(user) {
  state.user = user;
  els.identityLine.textContent = `${user.displayName || user.username} / ${user.globalRole}`;
  els.loginPanel.hidden = true;
  els.adminPanel.hidden = false;
  els.logoutBtn.hidden = false;
  await loadUsers();
}

async function boot() {
  try {
    const { user } = await api("/api/admin/me");
    await showAdmin(user);
  } catch {
    showLogin();
  }
}

async function loadUsers() {
  const { users } = await api("/api/admin/users");
  state.users = users;
  renderUsers();
}

function renderUsers() {
  els.userList.replaceChildren(
    ...state.users.map((user) => {
      const card = document.createElement("article");
      card.className = `user-card ${user.disabled ? "disabled" : ""}`;
      card.innerHTML = `
        <div class="card-title">${escapeHtml(user.username)} / ${escapeHtml(user.globalRole)}</div>
        <div class="card-meta">${escapeHtml(user.email || "no email")} / ${escapeHtml(user.displayName || "")}</div>
        <div class="user-actions">
          <select data-field="globalRole">
            <option value="user">user</option>
            <option value="admin">admin</option>
            <option value="super_admin">super admin</option>
          </select>
          <label><input data-field="dashboardAccess" type="checkbox" /> Dashboard</label>
          <label><input data-field="pmAccess" type="checkbox" /> PM</label>
          <label><input data-field="disabled" type="checkbox" /> Disabled</label>
          <button type="button">Save</button>
        </div>
      `;
      card.querySelector('[data-field="globalRole"]').value = user.globalRole;
      card.querySelector('[data-field="dashboardAccess"]').checked = user.dashboardAccess;
      card.querySelector('[data-field="pmAccess"]').checked = user.pmAccess;
      card.querySelector('[data-field="disabled"]').checked = user.disabled;
      card.querySelector("button").addEventListener("click", () => updateUser(user, card).catch((error) => alert(error.message)));
      return card;
    })
  );
}

async function updateUser(user, card) {
  const { user: updated } = await api(`/api/admin/users/${encodeURIComponent(user.id)}`, {
    method: "PATCH",
    body: JSON.stringify({
      globalRole: card.querySelector('[data-field="globalRole"]').value,
      dashboardAccess: card.querySelector('[data-field="dashboardAccess"]').checked,
      pmAccess: card.querySelector('[data-field="pmAccess"]').checked,
      disabled: card.querySelector('[data-field="disabled"]').checked
    })
  });
  state.users = state.users.map((item) => (item.id === updated.id ? updated : item));
  renderUsers();
}

async function createUser(event) {
  event.preventDefault();
  await api("/api/admin/users", {
    method: "POST",
    body: JSON.stringify({
      username: els.newUsername.value,
      email: els.newEmail.value || undefined,
      displayName: els.newDisplayName.value || undefined,
      password: els.newPassword.value,
      globalRole: els.newGlobalRole.value,
      dashboardAccess: els.newDashboardAccess.checked,
      pmAccess: els.newPmAccess.checked
    })
  });
  els.userForm.reset();
  await loadUsers();
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

els.loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const { user } = await api("/api/admin/login", {
      method: "POST",
      body: JSON.stringify({ usernameOrEmail: els.loginName.value, password: els.loginPassword.value })
    });
    els.loginPassword.value = "";
    await showAdmin(user);
  } catch (error) {
    showLogin(error.message);
  }
});

els.logoutBtn.addEventListener("click", async () => {
  await api("/api/admin/logout", { method: "POST" }).catch(() => undefined);
  showLogin();
});
els.userForm.addEventListener("submit", (event) => createUser(event).catch((error) => alert(error.message)));
els.refreshBtn.addEventListener("click", () => loadUsers().catch((error) => alert(error.message)));

boot();
