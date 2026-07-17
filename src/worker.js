import DEFAULT_HIERARCHY from "./seed-hierarchy.json";

const SESSION_COOKIE = "session";
const SESSION_DAYS = 14;
const VALID_TIERS = ["regimental_command", "battalion_command", "company_command"];
const PUBLIC_PAGES = ["/login.html", "/setup.html", "/reset-password.html"];

// Rank code -> rating-permission group. Regimental never appears as a rateable row.
const RANK_GROUPS = {
  "O-9": "regimental",
  "O-8": "regimental",
  "O-7": "regimental",
  "O-6": "regimental",
  "O-5": "battalion",
  "O-4": "battalion",
  "O-3": "captain",
  "O-2": "lieutenant",
  "O-1": "lieutenant",
};

const RATE_TARGETS = {
  regimental: ["battalion", "captain", "lieutenant"],
  battalion: ["battalion", "captain", "lieutenant"],
  captain: ["captain", "lieutenant"],
  lieutenant: [],
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path.startsWith("/api/")) {
      return handleApi(request, env, path).catch((err) => {
        console.error(err);
        return jsonResponse({ error: "Server error" }, 500);
      });
    }

    if (path.startsWith("/assets/") || PUBLIC_PAGES.includes(path)) {
      return serveAsset(request, env, url);
    }

    const officer = await getSessionOfficer(request, env);
    if (!officer) {
      return Response.redirect(`${url.origin}/login.html?next=${encodeURIComponent(path)}`, 302);
    }
    if (path === "/admin.html" && officer.tier !== "regimental_command") {
      return Response.redirect(`${url.origin}/chain-of-command.html`, 302);
    }

    return serveAsset(request, env, url);
  },
};

async function serveAsset(request, env, url) {
  // html_handling is set to "none" (so /login.html etc. don't get redirected to
  // extensionless URLs, which would bypass our path-based gating above) — but that
  // also disables the default "/" -> "/index.html" resolution, so do it ourselves.
  if (url.pathname === "/") {
    const rewritten = new URL(url);
    rewritten.pathname = "/index.html";
    request = new Request(rewritten.toString(), request);
  }
  return env.ASSETS.fetch(request);
}

async function handleApi(request, env, path) {
  const method = request.method;

  if (path === "/api/setup-status" && method === "GET") return apiSetupStatus(env);
  if (path === "/api/setup" && method === "POST") return apiSetup(request, env);
  if (path === "/api/login" && method === "POST") return apiLogin(request, env);
  if (path === "/api/logout" && method === "POST") return apiLogout(request, env);
  if (path === "/api/me" && method === "GET") return apiMe(request, env);
  if (path === "/api/hierarchy" && method === "GET") return apiGetHierarchy(request, env);
  if (path === "/api/hierarchy" && method === "PUT") return apiPutHierarchy(request, env);
  if (path === "/api/positions" && method === "GET") return apiGetPositions(request, env);
  if (path === "/api/request-reset" && method === "POST") return apiRequestReset(request, env);
  if (path === "/api/reset-password" && method === "POST") return apiResetPassword(request, env);
  if (path === "/api/officers" && method === "GET") return apiListOfficers(request, env);
  if (path === "/api/officers" && method === "POST") return apiCreateOfficer(request, env);
  if (path.startsWith("/api/officers/") && path.endsWith("/assign") && method === "POST") {
    return apiAssignOfficer(request, env, path.split("/")[3]);
  }
  if (path.startsWith("/api/officers/") && method === "DELETE") return apiDeleteOfficer(request, env, path);
  if (path === "/api/activity" && method === "GET") return apiGetActivity(request, env, url_(request));
  if (path === "/api/activity/rating" && method === "PUT") return apiPutActivityRating(request, env);

  return jsonResponse({ error: "Not found" }, 404);
}

function url_(request) {
  return new URL(request.url);
}

/* ---------------- setup / auth ---------------- */

async function apiSetupStatus(env) {
  const row = await env.DB.prepare("SELECT COUNT(*) AS c FROM officers").first();
  return jsonResponse({ needsSetup: row.c === 0 });
}

async function apiSetup(request, env) {
  const row = await env.DB.prepare("SELECT COUNT(*) AS c FROM officers").first();
  if (row.c > 0) return jsonResponse({ error: "Setup has already been completed" }, 403);

  const body = await parseJsonBody(request);
  if (!body) return jsonResponse({ error: "Invalid request body" }, 400);
  const { username, email, password } = body;
  if (!isValidUsername(username) || !isValidEmail(email) || !isValidPassword(password)) {
    return jsonResponse({ error: "A valid username, email, and password (8+ characters) are required" }, 400);
  }

  const salt = randomHex(16);
  const hash = await hashPassword(password, salt);

  let officerId;
  try {
    const result = await env.DB.prepare(
      `INSERT INTO officers (username, email, password_hash, password_salt, tier, display_name) VALUES (?, ?, ?, ?, 'regimental_command', ?)`
    )
      .bind(username, email, hash, salt, username)
      .run();
    officerId = result.meta.last_row_id;
  } catch {
    return jsonResponse({ error: "That username or email is already taken" }, 409);
  }

  await env.DB.prepare(`INSERT INTO hierarchy (id, data, updated_by) VALUES (1, ?, ?)`)
    .bind(JSON.stringify(DEFAULT_HIERARCHY), officerId)
    .run();

  return withSession(env, officerId, request, { ok: true });
}

async function apiLogin(request, env) {
  const body = await parseJsonBody(request);
  if (!body) return jsonResponse({ error: "Invalid request body" }, 400);
  const { username, password } = body;
  if (!username || !password) return jsonResponse({ error: "Username and password are required" }, 400);

  const officer = await env.DB
    .prepare("SELECT * FROM officers WHERE username = ? AND is_active = 1")
    .bind(username)
    .first();
  if (!officer) return jsonResponse({ error: "Invalid username or password" }, 401);

  const hash = await hashPassword(password, officer.password_salt);
  if (!timingSafeEqual(hash, officer.password_hash)) {
    return jsonResponse({ error: "Invalid username or password" }, 401);
  }

  return withSession(env, officer.id, request, {
    ok: true,
    tier: officer.tier,
    mustResetPassword: !!officer.must_reset_password,
  });
}

async function apiLogout(request, env) {
  const token = getCookie(request, SESSION_COOKIE);
  if (token) await env.DB.prepare("DELETE FROM sessions WHERE token = ?").bind(token).run();
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "Content-Type": "application/json", "Set-Cookie": cookieHeader(request, "", 0) },
  });
}

async function apiMe(request, env) {
  const officer = await getSessionOfficer(request, env);
  if (!officer) return jsonResponse({ error: "Not authenticated" }, 401);
  return jsonResponse({
    username: officer.username,
    tier: officer.tier,
    mustResetPassword: !!officer.must_reset_password,
  });
}

/* ---------------- hierarchy ---------------- */

async function getHierarchyData(env) {
  const row = await env.DB.prepare("SELECT data FROM hierarchy WHERE id = 1").first();
  return row ? JSON.parse(row.data) : null;
}

// Flatten every Regiment/Battalion/Company position into a list with unit context.
// Warrant Officers / Reserves are out of scope for occupancy-linking, so excluded here.
function flattenPositions(data) {
  const out = [];
  (data.regiment?.positions || []).forEach((p) => out.push({ ...p, unitLabel: "Regiment", parentType: "regiment" }));
  (data.battalions || []).forEach((bn) => {
    (bn.positions || []).forEach((p) => out.push({ ...p, unitLabel: bn.label, parentType: "battalion" }));
    (bn.companies || []).forEach((co) => {
      (co.positions || []).forEach((p) => out.push({ ...p, unitLabel: co.label, parentType: "company" }));
    });
  });
  return out;
}

async function getActiveOfficersBySeat(env) {
  const { results } = await env.DB
    .prepare(
      "SELECT id, display_name, current_position_id FROM officers WHERE is_active = 1 AND current_position_id IS NOT NULL"
    )
    .all();
  const map = new Map();
  results.forEach((o) => map.set(o.current_position_id, o));
  return map;
}

async function apiGetHierarchy(request, env) {
  const officer = await getSessionOfficer(request, env);
  if (!officer) return jsonResponse({ error: "Not authenticated" }, 401);

  const data = await getHierarchyData(env);
  if (!data) return jsonResponse({});

  const bySeat = await getActiveOfficersBySeat(env);
  const enrich = (positions) => {
    positions.forEach((p) => {
      const occupant = bySeat.get(p.id);
      if (occupant) {
        p.name = occupant.display_name;
        p.status = "filled";
      } else {
        p.status = p.closed ? "closed" : "vacant";
      }
    });
  };

  enrich(data.regiment?.positions || []);
  (data.battalions || []).forEach((bn) => {
    enrich(bn.positions || []);
    (bn.companies || []).forEach((co) => enrich(co.positions || []));
  });

  return jsonResponse(data);
}

async function apiPutHierarchy(request, env) {
  const officer = await getSessionOfficer(request, env);
  if (!officer) return jsonResponse({ error: "Not authenticated" }, 401);
  if (officer.tier !== "regimental_command") return jsonResponse({ error: "Forbidden" }, 403);

  const body = await parseJsonBody(request);
  if (!body || typeof body.hierarchy !== "object") {
    return jsonResponse({ error: "Invalid request body" }, 400);
  }

  // Strip any derived display fields before storing — structure only.
  const clean = body.hierarchy;
  const stripDerived = (positions) =>
    (positions || []).forEach((p) => {
      delete p.name;
      delete p.status;
    });
  stripDerived(clean.regiment?.positions);
  (clean.battalions || []).forEach((bn) => {
    stripDerived(bn.positions);
    (bn.companies || []).forEach((co) => stripDerived(co.positions));
  });

  const dataStr = JSON.stringify(clean);
  const summary = String(body.summary || "").slice(0, 200);

  await env.DB.batch([
    env.DB
      .prepare("UPDATE hierarchy SET data = ?, updated_at = datetime('now'), updated_by = ? WHERE id = 1")
      .bind(dataStr, officer.id),
    env.DB
      .prepare("INSERT INTO hierarchy_history (data, changed_by, change_summary) VALUES (?, ?, ?)")
      .bind(dataStr, officer.id, summary),
  ]);

  return jsonResponse({ ok: true });
}

async function apiGetPositions(request, env) {
  const officer = await getSessionOfficer(request, env);
  if (!officer) return jsonResponse({ error: "Not authenticated" }, 401);

  const data = await getHierarchyData(env);
  if (!data) return jsonResponse({ positions: [] });

  const bySeat = await getActiveOfficersBySeat(env);
  const positions = flattenPositions(data).map((p) => ({
    id: p.id,
    rank: p.rank,
    title: p.title,
    unitLabel: p.unitLabel,
    closed: !!p.closed,
    occupant: bySeat.has(p.id) ? { officerId: bySeat.get(p.id).id, displayName: bySeat.get(p.id).display_name } : null,
  }));

  return jsonResponse({ positions });
}

/* ---------------- officers ---------------- */

async function apiListOfficers(request, env) {
  const officer = await getSessionOfficer(request, env);
  if (!officer) return jsonResponse({ error: "Not authenticated" }, 401);
  if (officer.tier !== "regimental_command") return jsonResponse({ error: "Forbidden" }, 403);

  const { results } = await env.DB
    .prepare(
      "SELECT id, username, email, tier, display_name, current_position_id, is_active, created_at FROM officers ORDER BY created_at"
    )
    .all();
  return jsonResponse({ officers: results });
}

async function apiCreateOfficer(request, env) {
  const officer = await getSessionOfficer(request, env);
  if (!officer) return jsonResponse({ error: "Not authenticated" }, 401);
  if (officer.tier !== "regimental_command") return jsonResponse({ error: "Forbidden" }, 403);

  const body = await parseJsonBody(request);
  if (!body) return jsonResponse({ error: "Invalid request body" }, 400);
  const { username, email, tier, displayName, positionId } = body;
  if (!isValidUsername(username) || !isValidEmail(email) || !VALID_TIERS.includes(tier) || !displayName) {
    return jsonResponse({ error: "A valid username, email, tier, and display name are required" }, 400);
  }

  if (positionId) {
    const conflict = await env.DB
      .prepare("SELECT id FROM officers WHERE current_position_id = ? AND is_active = 1")
      .bind(positionId)
      .first();
    if (conflict) return jsonResponse({ error: "That seat is already occupied" }, 409);
  }

  const tempPassword = generateTempPassword();
  const salt = randomHex(16);
  const hash = await hashPassword(tempPassword, salt);

  try {
    await env.DB.prepare(
      `INSERT INTO officers (username, email, password_hash, password_salt, tier, must_reset_password, display_name, current_position_id) VALUES (?, ?, ?, ?, ?, 1, ?, ?)`
    )
      .bind(username, email, hash, salt, tier, displayName, positionId || null)
      .run();
  } catch {
    return jsonResponse({ error: "That username or email is already taken" }, 409);
  }

  return jsonResponse({ ok: true, tempPassword });
}

async function apiAssignOfficer(request, env, officerId) {
  const officer = await getSessionOfficer(request, env);
  if (!officer) return jsonResponse({ error: "Not authenticated" }, 401);
  if (officer.tier !== "regimental_command") return jsonResponse({ error: "Forbidden" }, 403);

  const body = await parseJsonBody(request);
  if (!body || !body.positionId) return jsonResponse({ error: "A positionId is required" }, 400);

  const conflict = await env.DB
    .prepare("SELECT id FROM officers WHERE current_position_id = ? AND is_active = 1 AND id != ?")
    .bind(body.positionId, officerId)
    .first();
  if (conflict) return jsonResponse({ error: "That seat is already occupied" }, 409);

  await env.DB.prepare("UPDATE officers SET current_position_id = ? WHERE id = ?").bind(body.positionId, officerId).run();
  return jsonResponse({ ok: true });
}

async function apiDeleteOfficer(request, env, path) {
  const officer = await getSessionOfficer(request, env);
  if (!officer) return jsonResponse({ error: "Not authenticated" }, 401);
  if (officer.tier !== "regimental_command") return jsonResponse({ error: "Forbidden" }, 403);

  const id = path.split("/").pop();
  if (String(officer.id) === String(id)) {
    return jsonResponse({ error: "You can't remove your own account" }, 400);
  }

  await env.DB.batch([
    env.DB.prepare("UPDATE officers SET is_active = 0, current_position_id = NULL WHERE id = ?").bind(id),
    env.DB.prepare("DELETE FROM sessions WHERE officer_id = ?").bind(id),
  ]);
  return jsonResponse({ ok: true });
}

/* ---------------- activity report ---------------- */

function rankGroup(rank) {
  return RANK_GROUPS[rank] || null;
}

function canRate(raterGroup, targetGroup) {
  return (RATE_TARGETS[raterGroup] || []).includes(targetGroup);
}

function mondayOf(date) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay(); // 0 = Sunday
  const diff = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diff);
  return d;
}

function isoDate(d) {
  return d.toISOString().slice(0, 10);
}

function weeksInMonth(year, month) {
  // month is 1-12
  const today = mondayOf(new Date());
  const first = new Date(Date.UTC(year, month - 1, 1));
  const last = new Date(Date.UTC(year, month, 0));
  const weeks = [];
  let cur = mondayOf(first);
  if (cur < first) cur.setUTCDate(cur.getUTCDate() + 7); // first Monday within (or after) the month start
  while (cur <= last) {
    if (cur <= today) weeks.push(isoDate(cur));
    cur = new Date(cur);
    cur.setUTCDate(cur.getUTCDate() + 7);
  }
  return weeks;
}

function quarterRange(year, month) {
  const q = Math.floor((month - 1) / 3); // 0..3
  const startMonth = q * 3 + 1;
  const start = `${year}-${String(startMonth).padStart(2, "0")}-01`;
  const endMonthDate = new Date(Date.UTC(year, startMonth + 2, 0));
  const end = isoDate(endMonthDate);
  return { start, end, label: `Q${q + 1} ${year}` };
}

async function resolveViewerGroup(env, officer) {
  if (officer.tier === "regimental_command") return "regimental";
  const data = await getHierarchyData(env);
  if (officer.current_position_id && data) {
    const positions = flattenPositions(data);
    const pos = positions.find((p) => p.id === officer.current_position_id);
    if (pos) return rankGroup(pos.rank) || (officer.tier === "battalion_command" ? "battalion" : "lieutenant");
  }
  return officer.tier === "battalion_command" ? "battalion" : "lieutenant";
}

async function apiGetActivity(request, env, url) {
  const officer = await getSessionOfficer(request, env);
  if (!officer) return jsonResponse({ error: "Not authenticated" }, 401);

  const now = new Date();
  const monthParam = url.searchParams.get("month"); // "YYYY-MM"
  let year = now.getUTCFullYear();
  let month = now.getUTCMonth() + 1;
  if (monthParam && /^\d{4}-\d{2}$/.test(monthParam)) {
    [year, month] = monthParam.split("-").map(Number);
  }

  const weeks = weeksInMonth(year, month);
  const { start: qStart, end: qEnd, label: qLabel } = quarterRange(year, month);

  const data = await getHierarchyData(env);
  if (!data) return jsonResponse({ weeks, rows: [], quarterLabel: qLabel });

  const positions = flattenPositions(data);
  const positionMap = new Map(positions.map((p) => [p.id, p]));
  // Hierarchy order (regiment, then each battalion followed by its companies) — rows are
  // sorted to match this so the grid can be sectioned by unit in a sensible reading order.
  const positionOrder = new Map(positions.map((p, i) => [p.id, i]));

  const viewerGroup = await resolveViewerGroup(env, officer);

  const { results: activeOfficers } = await env.DB
    .prepare(
      "SELECT id, display_name, current_position_id FROM officers WHERE is_active = 1 AND current_position_id IS NOT NULL"
    )
    .all();

  const rows = [];
  for (const o of activeOfficers) {
    const pos = positionMap.get(o.current_position_id);
    if (!pos) continue;
    const group = rankGroup(pos.rank);

    const { results: weekRatings } = await env.DB
      .prepare(
        `SELECT week_start, rating FROM activity_ratings WHERE officer_id = ? AND week_start IN (${weeks.map(() => "?").join(",") || "''"})`
      )
      .bind(o.id, ...weeks)
      .all();
    const ratingsByWeek = {};
    weekRatings.forEach((r) => (ratingsByWeek[r.week_start] = r.rating));

    const { results: qtrRatings } = await env.DB
      .prepare("SELECT rating FROM activity_ratings WHERE officer_id = ? AND week_start >= ? AND week_start <= ?")
      .bind(o.id, qStart, qEnd)
      .all();
    const numeric = qtrRatings.map((r) => r.rating).filter((r) => r !== "LOA").map(Number);
    const qtrAvg = numeric.length ? Math.round((numeric.reduce((a, b) => a + b, 0) / numeric.length) * 10) / 10 : null;

    rows.push({
      officerId: o.id,
      displayName: o.display_name,
      rank: pos.rank,
      title: pos.title,
      unitLabel: pos.unitLabel,
      section: pos.parentType === "regiment" ? "Regimental Command" : pos.unitLabel,
      ratings: ratingsByWeek,
      qtrAvg,
      canRate: o.id !== officer.id && canRate(viewerGroup, group),
      _order: positionOrder.get(pos.id) ?? 0,
    });
  }

  rows.sort((a, b) => a._order - b._order);
  rows.forEach((r) => delete r._order);

  return jsonResponse({ weeks, rows, quarterLabel: qLabel, currentWeek: isoDate(mondayOf(now)) });
}

async function apiPutActivityRating(request, env) {
  const officer = await getSessionOfficer(request, env);
  if (!officer) return jsonResponse({ error: "Not authenticated" }, 401);

  const body = await parseJsonBody(request);
  if (!body) return jsonResponse({ error: "Invalid request body" }, 400);
  const { targetOfficerId, weekStart, rating } = body;

  const currentWeek = isoDate(mondayOf(new Date()));
  if (weekStart !== currentWeek) {
    return jsonResponse({ error: "Only the current week can be rated" }, 400);
  }
  if (!["0", "1", "2", "3", "4", "5", "LOA"].includes(String(rating))) {
    return jsonResponse({ error: "Invalid rating value" }, 400);
  }
  if (String(targetOfficerId) === String(officer.id)) {
    return jsonResponse({ error: "You can't rate yourself" }, 400);
  }

  const target = await env.DB
    .prepare("SELECT id, current_position_id FROM officers WHERE id = ? AND is_active = 1")
    .bind(targetOfficerId)
    .first();
  if (!target || !target.current_position_id) return jsonResponse({ error: "Officer not found" }, 404);

  const data = await getHierarchyData(env);
  const positions = flattenPositions(data);
  const targetPos = positions.find((p) => p.id === target.current_position_id);
  if (!targetPos) return jsonResponse({ error: "Officer's seat not found" }, 404);

  const viewerGroup = await resolveViewerGroup(env, officer);
  const targetGroup = rankGroup(targetPos.rank);
  if (!canRate(viewerGroup, targetGroup)) {
    return jsonResponse({ error: "You don't have permission to rate this officer" }, 403);
  }

  await env.DB
    .prepare(
      `INSERT INTO activity_ratings (officer_id, week_start, rating, rated_by) VALUES (?, ?, ?, ?)
       ON CONFLICT(officer_id, week_start) DO UPDATE SET rating = excluded.rating, rated_by = excluded.rated_by, created_at = datetime('now')`
    )
    .bind(targetOfficerId, weekStart, String(rating), officer.id)
    .run();

  return jsonResponse({ ok: true });
}

/* ---------------- password reset ---------------- */

async function apiRequestReset(request, env) {
  const body = await parseJsonBody(request);
  if (!body || !isValidEmail(body.email)) return jsonResponse({ error: "A valid email is required" }, 400);

  const officer = await env.DB
    .prepare("SELECT * FROM officers WHERE email = ? AND is_active = 1")
    .bind(body.email)
    .first();
  if (officer) {
    const token = randomHex(32);
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    await env.DB
      .prepare("INSERT INTO password_resets (token, officer_id, expires_at) VALUES (?, ?, ?)")
      .bind(token, officer.id, expiresAt)
      .run();

    const url = new URL(request.url);
    const resetLink = `${url.origin}/reset-password.html?token=${token}`;
    await sendResetEmail(env, officer.email, resetLink);
  }

  // Always the same response, whether or not the email matched, so we don't reveal who's registered.
  return jsonResponse({ ok: true, message: "If that email is registered, a reset link has been sent." });
}

async function apiResetPassword(request, env) {
  const body = await parseJsonBody(request);
  if (!body) return jsonResponse({ error: "Invalid request body" }, 400);
  const { token, newPassword } = body;
  if (!token || !isValidPassword(newPassword)) {
    return jsonResponse({ error: "A reset token and a password of at least 8 characters are required" }, 400);
  }

  const reset = await env.DB
    .prepare("SELECT * FROM password_resets WHERE token = ? AND used = 0 AND expires_at > datetime('now')")
    .bind(token)
    .first();
  if (!reset) return jsonResponse({ error: "That reset link is invalid or has expired" }, 400);

  const salt = randomHex(16);
  const hash = await hashPassword(newPassword, salt);

  await env.DB.batch([
    env.DB
      .prepare("UPDATE officers SET password_hash = ?, password_salt = ?, must_reset_password = 0 WHERE id = ?")
      .bind(hash, salt, reset.officer_id),
    env.DB.prepare("UPDATE password_resets SET used = 1 WHERE token = ?").bind(token),
    env.DB.prepare("DELETE FROM sessions WHERE officer_id = ?").bind(reset.officer_id),
  ]);

  return jsonResponse({ ok: true });
}

async function sendResetEmail(env, toEmail, resetLink) {
  if (!env.RESEND_API_KEY) {
    console.error("RESEND_API_KEY is not set — skipping password reset email send");
    return;
  }
  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: "5th Marine Regiment Command Hub <onboarding@resend.dev>",
      to: [toEmail],
      subject: "Reset your Command Hub password",
      html: `<p>Click the link below to reset your password. This link expires in 1 hour.</p><p><a href="${resetLink}">${resetLink}</a></p><p>If you didn't request this, you can ignore this email.</p>`,
    }),
  });
}

/* ---------------- sessions / cookies ---------------- */

async function getSessionOfficer(request, env) {
  const token = getCookie(request, SESSION_COOKIE);
  if (!token) return null;
  return env.DB
    .prepare(
      `SELECT officers.* FROM sessions JOIN officers ON officers.id = sessions.officer_id
       WHERE sessions.token = ? AND sessions.expires_at > datetime('now') AND officers.is_active = 1`
    )
    .bind(token)
    .first();
}

async function withSession(env, officerId, request, responseBody) {
  const token = randomHex(32);
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  await env.DB
    .prepare("INSERT INTO sessions (token, officer_id, expires_at) VALUES (?, ?, ?)")
    .bind(token, officerId, expiresAt)
    .run();

  return new Response(JSON.stringify(responseBody), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Set-Cookie": cookieHeader(request, token, SESSION_DAYS * 24 * 60 * 60),
    },
  });
}

function cookieHeader(request, token, maxAgeSeconds) {
  const secure = new URL(request.url).protocol === "https:" ? " Secure;" : "";
  return `${SESSION_COOKIE}=${token}; HttpOnly;${secure} SameSite=Lax; Path=/; Max-Age=${maxAgeSeconds}`;
}

function getCookie(request, name) {
  const header = request.headers.get("Cookie") || "";
  const match = header.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

/* ---------------- crypto / validation helpers ---------------- */

async function hashPassword(password, saltHex) {
  const salt = hexToBytes(saltHex);
  const keyMaterial = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, [
    "deriveBits",
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: 100000, hash: "SHA-256" },
    keyMaterial,
    256
  );
  return bytesToHex(new Uint8Array(bits));
}

function randomHex(byteLength) {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return bytesToHex(bytes);
}

function generateTempPassword() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => alphabet[b % alphabet.length]).join("");
}

function bytesToHex(bytes) {
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function hexToBytes(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  return bytes;
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return result === 0;
}

function isValidUsername(v) {
  return typeof v === "string" && /^[a-zA-Z0-9_.-]{3,32}$/.test(v);
}

function isValidEmail(v) {
  return typeof v === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

function isValidPassword(v) {
  return typeof v === "string" && v.length >= 8;
}

async function parseJsonBody(request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
}
