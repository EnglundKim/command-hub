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

    // No home page: the root just routes you to the right place, and a
    // logged-in visitor hitting the login page skips straight to the roster.
    if (path === "/" || path === "/index.html" || path === "/login.html") {
      const officer = await getSessionOfficer(request, env);
      if (officer) {
        return Response.redirect(`${url.origin}/chain-of-command.html`, 302);
      }
      return path === "/login.html"
        ? serveAsset(request, env, url)
        : Response.redirect(`${url.origin}/login.html`, 302);
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
  // extensionless URLs, which would bypass our path-based gating above). "/" never
  // reaches here — fetch() redirects it to login or chain-of-command.
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
  if (path.startsWith("/api/officers/") && path.endsWith("/reserve") && method === "POST") {
    return apiReserveOfficer(request, env, path.split("/")[3]);
  }
  if (path.startsWith("/api/officers/") && method === "DELETE") return apiDeleteOfficer(request, env, path);
  if (path === "/api/activity" && method === "GET") return apiGetActivity(request, env, url_(request));
  if (path === "/api/activity/rating" && method === "PUT") return apiPutActivityRating(request, env);
  if (path === "/api/server-stats" && method === "GET") return apiServerStats(request, env);

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
  if (!body) return jsonResponse({ error: "Invalid request body" }, 400);

  // A null positionId unseats the officer ("— No seat —" in the Reassign dropdown).
  if (body.positionId) {
    const conflict = await env.DB
      .prepare("SELECT id FROM officers WHERE current_position_id = ? AND is_active = 1 AND id != ?")
      .bind(body.positionId, officerId)
      .first();
    if (conflict) return jsonResponse({ error: "That seat is already occupied" }, 409);
  }

  await env.DB
    .prepare("UPDATE officers SET current_position_id = ? WHERE id = ?")
    .bind(body.positionId || null, officerId)
    .run();
  return jsonResponse({ ok: true });
}

// Moves an officer off their seat and onto the Reserves list (login stays active).
// The Reserves entry carries their current rank; corrections happen in the editor.
async function apiReserveOfficer(request, env, officerId) {
  const officer = await getSessionOfficer(request, env);
  if (!officer) return jsonResponse({ error: "Not authenticated" }, 401);
  if (officer.tier !== "regimental_command") return jsonResponse({ error: "Forbidden" }, 403);

  const target = await env.DB
    .prepare("SELECT id, display_name, username, current_position_id FROM officers WHERE id = ? AND is_active = 1")
    .bind(officerId)
    .first();
  if (!target) return jsonResponse({ error: "Officer not found" }, 404);

  const data = await getHierarchyData(env);
  if (!data) return jsonResponse({ error: "Hierarchy not set up yet" }, 500);

  const seat = target.current_position_id
    ? flattenPositions(data).find((p) => p.id === target.current_position_id)
    : null;
  const name = target.display_name || target.username;

  if (!data.reserves) data.reserves = { label: "Reserves", positions: [] };
  if (!Array.isArray(data.reserves.positions)) data.reserves.positions = [];
  data.reserves.positions.push({ rank: seat ? seat.rank : "", title: "", name, status: "filled" });

  const dataStr = JSON.stringify(data);
  await env.DB.batch([
    env.DB
      .prepare("UPDATE hierarchy SET data = ?, updated_at = datetime('now'), updated_by = ? WHERE id = 1")
      .bind(dataStr, officer.id),
    env.DB
      .prepare("INSERT INTO hierarchy_history (data, changed_by, change_summary) VALUES (?, ?, ?)")
      .bind(dataStr, officer.id, `Moved ${name} to Reserves`),
    env.DB.prepare("UPDATE officers SET current_position_id = NULL WHERE id = ?").bind(target.id),
  ]);

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

// "O-8" -> 8; non-officer codes (warrant etc.) -> 0, so they never outrank anyone
function rankIndex(rank) {
  const m = /^O-(\d)$/.exec(rank || "");
  return m ? Number(m[1]) : 0;
}

// Within Regimental Command, rating follows strict seniority: only a strictly
// higher rank may rate. One exception per unit policy: the O-7 may also rate
// the O-8. Everything else uses the group matrix.
function canRateTarget(viewer, targetGroup, targetRank) {
  if (viewer.group === "regimental" && targetGroup === "regimental") {
    if (viewer.rank === "O-7" && targetRank === "O-8") return true;
    return rankIndex(viewer.rank) > rankIndex(targetRank);
  }
  return (RATE_TARGETS[viewer.group] || []).includes(targetGroup);
}

function mondayOf(date) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay(); // 0 = Sunday
  const diff = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diff);
  return d;
}

// A week stays editable through its own 7 days plus a 30-day grace period after it
// ends (day 37 onward is locked). The is_admin account bypasses this entirely.
function isWeekEditable(weekStartIso) {
  const weekStart = Date.parse(weekStartIso + "T00:00:00Z");
  const now = new Date();
  const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return todayUtc < weekStart + 37 * 24 * 60 * 60 * 1000;
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

async function resolveViewerRating(env, officer) {
  // The viewer's seat rank is needed for the intra-regimental seniority rule;
  // a seatless viewer gets rank null (rankIndex 0 — outranks no one).
  let rank = null;
  const data = await getHierarchyData(env);
  if (officer.current_position_id && data) {
    const positions = flattenPositions(data);
    const pos = positions.find((p) => p.id === officer.current_position_id);
    if (pos) rank = pos.rank;
  }
  if (officer.tier === "regimental_command") return { group: "regimental", rank };
  const group =
    rankGroup(rank) || (officer.tier === "battalion_command" ? "battalion" : "lieutenant");
  return { group, rank };
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

  const viewer = await resolveViewerRating(env, officer);
  const isAdmin = officer.is_admin === 1;
  const editableWeeks = isAdmin ? [...weeks] : weeks.filter(isWeekEditable);

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
      canRate: isAdmin || (o.id !== officer.id && canRateTarget(viewer, group, pos.rank)),
      _order: positionOrder.get(pos.id) ?? 0,
    });
  }

  rows.sort((a, b) => a._order - b._order);
  rows.forEach((r) => delete r._order);

  return jsonResponse({ weeks, editableWeeks, rows, quarterLabel: qLabel, currentWeek: isoDate(mondayOf(now)) });
}

async function apiPutActivityRating(request, env) {
  const officer = await getSessionOfficer(request, env);
  if (!officer) return jsonResponse({ error: "Not authenticated" }, 401);

  const body = await parseJsonBody(request);
  if (!body) return jsonResponse({ error: "Invalid request body" }, 400);
  const { targetOfficerId, weekStart, rating } = body;

  // weekStart must be a real Monday, not in the future.
  const currentWeek = isoDate(mondayOf(new Date()));
  const weekDate = /^\d{4}-\d{2}-\d{2}$/.test(String(weekStart)) ? new Date(weekStart + "T00:00:00Z") : null;
  if (!weekDate || Number.isNaN(weekDate.getTime()) || isoDate(mondayOf(weekDate)) !== weekStart || weekStart > currentWeek) {
    return jsonResponse({ error: "Invalid week" }, 400);
  }
  const isAdmin = officer.is_admin === 1;
  if (!isAdmin && !isWeekEditable(weekStart)) {
    return jsonResponse({ error: "Ratings can only be changed within 30 days of the week's end" }, 400);
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

  if (!isAdmin) {
    const viewer = await resolveViewerRating(env, officer);
    const targetGroup = rankGroup(targetPos.rank);
    if (!canRateTarget(viewer, targetGroup, targetPos.rank)) {
      return jsonResponse({ error: "You don't have permission to rate this officer" }, 403);
    }
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

/* ---------------- server stats (Discord join/leave log, Google Sheet CSV) ---------------- */

const SERVER_STATS_CACHE_MS = 5 * 60 * 1000;
const SERVER_STATS_WEEKS = 12;
// Per-isolate cache so we don't re-download the sheet on every page view.
let serverStatsCache = { url: null, fetchedAt: 0, payload: null };

async function apiServerStats(request, env) {
  const officer = await getSessionOfficer(request, env);
  if (!officer) return jsonResponse({ error: "Not authenticated" }, 401);

  if (!env.SHEET_CSV_URL) return jsonResponse({ configured: false });

  const now = Date.now();
  if (
    serverStatsCache.payload &&
    serverStatsCache.url === env.SHEET_CSV_URL &&
    now - serverStatsCache.fetchedAt < SERVER_STATS_CACHE_MS
  ) {
    return jsonResponse(serverStatsCache.payload);
  }

  const res = await fetch(env.SHEET_CSV_URL, { redirect: "follow" });
  if (!res.ok) return jsonResponse({ error: "Could not fetch the stats sheet" }, 502);
  const csv = await res.text();

  const { events, skippedRows } = parseJoinLeaveCsv(csv);
  const payload = buildServerStats(events, skippedRows);
  serverStatsCache = { url: env.SHEET_CSV_URL, fetchedAt: now, payload };
  return jsonResponse(payload);
}

function parseCsvRows(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      rows.push(row);
      row = [];
    } else {
      field += ch;
    }
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function parseJoinLeaveCsv(csv) {
  const rows = parseCsvRows(csv).filter((r) => r.some((c) => c.trim() !== ""));
  if (!rows.length) return { events: [], skippedRows: 0 };

  // Columns default to Date, User, Action; a header row (if present) can reorder them.
  let dateCol = 0;
  let userCol = 1;
  let actionCol = 2;
  let start = 0;
  const header = rows[0].map((c) => c.trim().toLowerCase());
  if (header.some((c) => c.includes("date") || c.includes("user") || c.includes("action"))) {
    start = 1;
    const find = (...names) => header.findIndex((c) => names.some((n) => c.includes(n)));
    const d = find("date", "time");
    if (d !== -1) dateCol = d;
    const u = find("user", "name", "member");
    if (u !== -1) userCol = u;
    const a = find("action", "join", "leave", "event", "type", "status");
    if (a !== -1) actionCol = a;
  }

  const dayFirst = detectDayFirst(rows, dateCol, start);
  const events = [];
  let skippedRows = 0;
  for (let i = start; i < rows.length; i++) {
    const time = parseEventDate(rows[i][dateCol], dayFirst);
    const user = (rows[i][userCol] || "").trim();
    const action = normalizeAction(rows[i][actionCol]);
    if (time === null || !action) {
      skippedRows++;
      continue;
    }
    events.push({ time, user, action });
  }
  events.sort((a, b) => a.time - b.time);
  return { events, skippedRows };
}

// Slash dates are ambiguous (7/6 vs 6/7). If any row proves the order, trust it;
// otherwise assume day-first — this unit writes dates as DD/M/YY.
function detectDayFirst(rows, dateCol, start) {
  for (let i = start; i < rows.length; i++) {
    const m = (rows[i][dateCol] || "").trim().match(/^(\d{1,2})\/(\d{1,2})\//);
    if (!m) continue;
    if (+m[1] > 12) return true;
    if (+m[2] > 12) return false;
  }
  return true;
}

function parseEventDate(raw, dayFirst) {
  const s = (raw || "").trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return Date.UTC(+m[1], +m[2] - 1, +m[3]);
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (m) {
    let year = +m[3];
    if (year < 100) year += 2000;
    const day = dayFirst ? +m[1] : +m[2];
    const month = dayFirst ? +m[2] : +m[1];
    return Date.UTC(year, month - 1, day);
  }
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : t;
}

function normalizeAction(raw) {
  const s = (raw || "").trim().toLowerCase();
  if (s.startsWith("j")) return "join";
  if (s.startsWith("l")) return "leave";
  return null;
}

function buildServerStats(events, skippedRows) {
  const counts = (list) => {
    let joins = 0;
    let leaves = 0;
    for (const e of list) e.action === "join" ? joins++ : leaves++;
    return { joins, leaves, net: joins - leaves };
  };

  const now = new Date();
  const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const dayMs = 24 * 60 * 60 * 1000;
  const since = (days) => counts(events.filter((e) => e.time >= todayUtc - (days - 1) * dayMs));

  // Daily buckets for the last 30 days (the "joins, leaves & intake" chart).
  const daily = [];
  for (let i = 29; i >= 0; i--) {
    const dayStart = todayUtc - i * dayMs;
    const inDay = events.filter((e) => e.time >= dayStart && e.time < dayStart + dayMs);
    daily.push({ date: isoDate(new Date(dayStart)), ...counts(inDay) });
  }

  // Weekly buckets: the last 12 Monday-start weeks, current week last.
  const thisMonday = mondayOf(now).getTime();
  const weekly = [];
  for (let i = SERVER_STATS_WEEKS - 1; i >= 0; i--) {
    const weekStart = thisMonday - i * 7 * dayMs;
    const inWeek = events.filter((e) => e.time >= weekStart && e.time < weekStart + 7 * dayMs);
    weekly.push({ weekStart: isoDate(new Date(weekStart)), ...counts(inWeek) });
  }

  // Cumulative net members since the log began, one point per day.
  const growth = [];
  if (events.length) {
    let running = 0;
    let idx = 0;
    for (let t = events[0].time; t <= todayUtc; t += dayMs) {
      while (idx < events.length && events[idx].time < t + dayMs) {
        running += events[idx].action === "join" ? 1 : -1;
        idx++;
      }
      growth.push({ date: isoDate(new Date(t)), total: running });
    }
  }

  // Per-calendar-month totals.
  const monthMap = new Map();
  for (const e of events) {
    const key = isoDate(new Date(e.time)).slice(0, 7); // "YYYY-MM"
    if (!monthMap.has(key)) monthMap.set(key, { joins: 0, leaves: 0 });
    const m = monthMap.get(key);
    e.action === "join" ? m.joins++ : m.leaves++;
  }
  const monthly = [...monthMap.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([month, m]) => ({ month, joins: m.joins, leaves: m.leaves, net: m.joins - m.leaves }));

  const retention = buildRetention(events, dayMs);

  const recent = events
    .slice(-25)
    .reverse()
    .map((e) => ({ date: isoDate(new Date(e.time)), user: e.user, action: e.action }));

  return {
    configured: true,
    totals: counts(events),
    last7: since(7),
    last30: since(30),
    daily,
    weekly,
    growth,
    monthly,
    retention,
    recent,
    totalEvents: events.length,
    skippedRows,
    firstDate: events.length ? isoDate(new Date(events[0].time)) : null,
    lastDate: events.length ? isoDate(new Date(events[events.length - 1].time)) : null,
  };
}

// Pairs each user's Join with their next Leave (a "stint") to measure how long
// people stay. Leaves with no prior Join (joined before the log began) are ignored.
function buildRetention(events, dayMs) {
  const byUser = new Map();
  for (const e of events) {
    if (!byUser.has(e.user)) byUser.set(e.user, []);
    byUser.get(e.user).push(e);
  }

  let uniqueJoiners = 0;
  let rejoiners = 0;
  let openStints = 0;
  const stayDays = [];
  for (const list of byUser.values()) {
    let joinCount = 0;
    let openJoin = null;
    for (const e of list) {
      if (e.action === "join") {
        joinCount++;
        openJoin = e.time; // a repeated Join just restarts the stint
      } else if (openJoin !== null) {
        stayDays.push(Math.round((e.time - openJoin) / dayMs));
        openJoin = null;
      }
    }
    if (joinCount > 0) uniqueJoiners++;
    if (joinCount > 1) rejoiners++;
    if (openJoin !== null) openStints++;
  }

  stayDays.sort((a, b) => a - b);
  const medianStayDays = stayDays.length ? stayDays[Math.floor(stayDays.length / 2)] : null;
  const quickQuitPct = stayDays.length
    ? Math.round((stayDays.filter((d) => d <= 7).length / stayDays.length) * 100)
    : null;

  return { uniqueJoiners, rejoiners, openStints, completedStints: stayDays.length, medianStayDays, quickQuitPct };
}
