function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined) continue;
    if (key === "class") node.className = value;
    else if (key === "text") node.textContent = value;
    else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value);
  }
  for (const child of [].concat(children)) if (child) node.appendChild(child);
  return node;
}

let positionsCache = [];

async function loadPositions() {
  const { positions } = await apiFetch("/api/positions");
  positionsCache = positions;
  return positions;
}

function positionLabel(p) {
  return `${p.unitLabel} — [${p.rank}] ${p.title}`;
}

function seatSelect(currentPositionId, excludeOfficerId) {
  const available = positionsCache.filter(
    (p) => !p.closed && (!p.occupant || p.occupant.officerId === excludeOfficerId)
  );
  return el(
    "select",
    { id: "seat-picker" },
    [
      el("option", { value: "", text: "— No seat —" }),
      ...available.map((p) =>
        el("option", { value: p.id, text: positionLabel(p), selected: p.id === currentPositionId ? "selected" : null })
      ),
    ]
  );
}

/* ---------------- Officers ---------------- */

async function loadOfficers() {
  const callout = document.getElementById("officer-callout");
  const body = document.getElementById("officers-body");
  body.innerHTML = "";
  try {
    await loadPositions();
    const { officers } = await apiFetch("/api/officers");
    const positionById = new Map(positionsCache.map((p) => [p.id, p]));

    officers.forEach((o) => {
      const seat = o.current_position_id ? positionById.get(o.current_position_id) : null;
      const row = el("tr", {}, [
        el("td", { text: o.display_name || o.username }),
        el("td", { text: o.username }),
        el("td", { text: o.email }),
        el("td", { text: o.tier.replace("_", " ") }),
        el("td", { text: seat ? positionLabel(seat) : "Unassigned" }),
        el("td", {}, [
          el("button", {
            class: "admin-btn admin-btn--small",
            text: "Reassign",
            onclick: () => startReassign(row, o),
          }),
          el("button", {
            class: "admin-btn admin-btn--small",
            text: "To Reserves",
            onclick: () => moveToReserves(o),
          }),
          el("button", {
            class: "admin-btn admin-btn--danger admin-btn--small",
            text: "Remove",
            onclick: () => removeOfficer(o.id, o.username),
          }),
        ]),
      ]);
      body.appendChild(row);
    });
  } catch (err) {
    callout.appendChild(el("div", { class: "auth-message auth-message--error", text: err.message }));
  }
}

function startReassign(row, officer) {
  const existing = row.querySelector(".reassign-row");
  if (existing) {
    existing.remove();
    return;
  }
  const select = seatSelect(officer.current_position_id, officer.id);
  const confirmBtn = el("button", {
    class: "admin-btn admin-btn--primary admin-btn--small",
    text: "Confirm",
    onclick: async () => {
      try {
        await apiFetch(`/api/officers/${officer.id}/assign`, {
          method: "POST",
          body: { positionId: select.value || null },
        });
        loadOfficers();
      } catch (err) {
        alert(err.message);
      }
    },
  });
  const tr = el("tr", { class: "reassign-row" }, [
    el("td", { colspan: "6" }, [
      el("div", { class: "editor-row" }, [select, confirmBtn]),
    ]),
  ]);
  row.after(tr);
}

async function moveToReserves(officer) {
  const name = officer.display_name || officer.username;
  if (
    !confirm(
      `Move "${name}" to Reserves? Their seat becomes vacant and they appear on the Reserves list (keeping their rank). They can still log in.`
    )
  )
    return;
  try {
    await apiFetch(`/api/officers/${officer.id}/reserve`, { method: "POST" });
    loadOfficers();
    loadHierarchy(); // the Reserves section just gained an entry
  } catch (err) {
    alert(err.message);
  }
}

async function removeOfficer(id, username) {
  if (
    !confirm(
      `Deactivate "${username}"? They'll no longer be able to log in and their seat becomes vacant, but every rating they gave or received stays on record.`
    )
  )
    return;
  try {
    await apiFetch(`/api/officers/${id}`, { method: "DELETE" });
    loadOfficers();
  } catch (err) {
    alert(err.message);
  }
}

document.getElementById("add-officer-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const callout = document.getElementById("officer-callout");
  callout.innerHTML = "";

  const username = document.getElementById("new-username").value.trim();
  const displayName = document.getElementById("new-display-name").value.trim();
  const email = document.getElementById("new-email").value.trim();
  const tier = document.getElementById("new-tier").value;
  const positionId = document.getElementById("new-seat").value || null;

  try {
    const res = await apiFetch("/api/officers", {
      method: "POST",
      body: { username, displayName, email, tier, positionId },
    });
    callout.appendChild(
      el("div", { class: "admin-callout" }, [
        document.createTextNode(
          `Account created. Temporary password (share this with ${username} — it won't be shown again): `
        ),
        el("code", { text: res.tempPassword }),
      ])
    );
    e.target.reset();
    loadOfficers();
  } catch (err) {
    callout.appendChild(el("div", { class: "auth-message auth-message--error", text: err.message }));
  }
});

async function populateNewOfficerSeats() {
  await loadPositions();
  const select = document.getElementById("new-seat");
  select.innerHTML = "";
  select.appendChild(el("option", { value: "", text: "— No seat yet —" }));
  positionsCache
    .filter((p) => !p.closed && !p.occupant)
    .forEach((p) => select.appendChild(el("option", { value: p.id, text: positionLabel(p) })));
}

/* ---------------- Hierarchy editor ---------------- */

let hierarchyData = null;

async function loadHierarchy() {
  const container = document.getElementById("hierarchy-editor");
  try {
    hierarchyData = await apiFetch("/api/hierarchy");
    renderEditor();
  } catch (err) {
    container.innerHTML = "";
    container.appendChild(el("div", { class: "auth-message auth-message--error", text: err.message }));
  }
}

function renderEditor() {
  const container = document.getElementById("hierarchy-editor");
  container.innerHTML = "";
  container.appendChild(renderRegiment());
  container.appendChild(renderBattalions());
  container.appendChild(renderWarrantOfficers());
  container.appendChild(renderReserves());
}

function rankSelectWithPreview(pos, onChange) {
  const preview = el("img", { class: "editor-rank-preview", src: RANK_ICONS[pos.rank] || "", alt: "" });
  preview.style.visibility = RANK_ICONS[pos.rank] ? "visible" : "hidden";

  const select = el(
    "select",
    {
      "data-field": "rank",
      onchange: (e) => {
        pos.rank = e.target.value;
        const iconSrc = RANK_ICONS[pos.rank];
        preview.src = iconSrc || "";
        preview.style.visibility = iconSrc ? "visible" : "hidden";
        if (onChange) onChange();
      },
    },
    [
      el("option", { value: "", text: "—", selected: !pos.rank ? "selected" : null }),
      ...RANKS.map((r) =>
        el("option", { value: r.code, text: r.code, selected: pos.rank === r.code ? "selected" : null })
      ),
    ]
  );

  return el("span", { class: "editor-rank-field" }, [preview, select]);
}

// Regiment/Battalion/Company positions: structure only — rank, title, closed.
// Who occupies a seat is managed from the Officers section, not here.
function renderStructurePositionsList(positions, idPrefix) {
  const wrap = el("div", {});
  positions.forEach((pos, i) => {
    wrap.appendChild(
      el("div", { class: "editor-row" }, [
        rankSelectWithPreview(pos),
        el("input", {
          type: "text",
          "data-field": "title",
          placeholder: "Title",
          value: pos.title || "",
          oninput: (e) => {
            pos.title = e.target.value;
          },
        }),
        el("label", { class: "editor-checkbox" }, [
          el("input", {
            type: "checkbox",
            checked: pos.closed ? "checked" : null,
            onchange: (e) => {
              pos.closed = e.target.checked;
            },
          }),
          el("span", { text: "Closed" }),
        ]),
        // Read-only occupant display (assignments happen in the Officers section);
        // pos.name is enriched by GET /api/hierarchy and stripped again on save.
        el("input", {
          type: "text",
          class: pos.name ? "editor-occupant" : "editor-occupant editor-occupant--empty",
          value: pos.name || (pos.closed ? "— Closed —" : "— Vacant —"),
          disabled: "disabled",
        }),
        el("button", {
          class: "admin-btn admin-btn--danger admin-btn--small",
          text: "Remove",
          onclick: () => {
            positions.splice(i, 1);
            renderEditor();
          },
        }),
      ])
    );
  });

  wrap.appendChild(
    el("button", {
      class: "admin-btn admin-btn--small",
      text: "+ Add Position",
      onclick: () => {
        positions.push({ id: `${idPrefix}-pos-${Date.now()}`, rank: "", title: "", closed: false });
        renderEditor();
      },
    })
  );
  return wrap;
}

// Warrant Officers / Reserves: unchanged, still directly-typed name + status.
function renderNamedPositionsList(positions) {
  const wrap = el("div", {});
  positions.forEach((pos, i) => {
    const nameInput = el("input", {
      type: "text",
      "data-field": "name",
      placeholder: "Name (no rank prefix)",
      value: pos.name || "",
      oninput: (e) => {
        pos.name = e.target.value;
      },
    });
    nameInput.disabled = pos.status !== "filled";

    const statusSelect = el(
      "select",
      {
        onchange: (e) => {
          pos.status = e.target.value;
          if (pos.status !== "filled") delete pos.name;
          renderEditor();
        },
      },
      ["filled", "vacant", "closed"].map((s) =>
        el("option", { value: s, text: s, selected: pos.status === s ? "selected" : null })
      )
    );

    wrap.appendChild(
      el("div", { class: "editor-row" }, [
        rankSelectWithPreview(pos),
        el("input", {
          type: "text",
          "data-field": "title",
          placeholder: "Title",
          value: pos.title || "",
          oninput: (e) => {
            pos.title = e.target.value;
          },
        }),
        statusSelect,
        nameInput,
        el("button", {
          class: "admin-btn admin-btn--danger admin-btn--small",
          text: "Remove",
          onclick: () => {
            positions.splice(i, 1);
            renderEditor();
          },
        }),
      ])
    );
  });

  wrap.appendChild(
    el("button", {
      class: "admin-btn admin-btn--small",
      text: "+ Add Position",
      onclick: () => {
        positions.push({ rank: "", title: "", status: "vacant" });
        renderEditor();
      },
    })
  );
  return wrap;
}

function renderRegiment() {
  return el("div", { class: "editor-unit" }, [
    el("div", { class: "editor-unit__header" }, [el("strong", { text: "Regiment" })]),
    renderStructurePositionsList(hierarchyData.regiment.positions, "reg"),
  ]);
}

function renderCompany(company, battalion) {
  return el("div", { class: "editor-unit" }, [
    el("div", { class: "editor-unit__header" }, [
      el("input", {
        type: "text",
        value: company.label,
        oninput: (e) => {
          company.label = e.target.value;
        },
      }),
      el("button", {
        class: "admin-btn admin-btn--danger admin-btn--small",
        text: "Remove Company",
        onclick: () => {
          battalion.companies = battalion.companies.filter((c) => c !== company);
          renderEditor();
        },
      }),
    ]),
    renderStructurePositionsList(company.positions, company.id),
  ]);
}

function renderBattalions() {
  const section = el("div", { class: "editor-unit" }, [
    el("div", { class: "editor-unit__header" }, [el("strong", { text: "Battalions" })]),
  ]);

  hierarchyData.battalions.forEach((battalion) => {
    const block = el("div", { class: "editor-unit" }, [
      el("div", { class: "editor-unit__header" }, [
        el("input", {
          type: "text",
          value: battalion.label,
          oninput: (e) => {
            battalion.label = e.target.value;
          },
        }),
        el("button", {
          class: "admin-btn admin-btn--danger admin-btn--small",
          text: "Remove Battalion",
          onclick: () => {
            hierarchyData.battalions = hierarchyData.battalions.filter((b) => b !== battalion);
            renderEditor();
          },
        }),
      ]),
      renderStructurePositionsList(battalion.positions, battalion.id),
      el(
        "div",
        { class: "editor-companies" },
        (battalion.companies || []).map((c) => renderCompany(c, battalion))
      ),
      el("div", { class: "editor-actions" }, [
        el("button", {
          class: "admin-btn admin-btn--small",
          text: "+ Add Company",
          onclick: () => {
            const newId = `co-${Date.now()}`;
            battalion.companies = battalion.companies || [];
            battalion.companies.push({
              id: newId,
              label: "New Company",
              positions: [{ id: `${newId}-pos-1`, rank: "O-3", title: "Captain", closed: false }],
            });
            renderEditor();
          },
        }),
      ]),
    ]);
    section.appendChild(block);
  });

  section.appendChild(
    el("button", {
      class: "admin-btn admin-btn--small",
      text: "+ Add Battalion",
      onclick: () => {
        const newId = `bn-${Date.now()}`;
        hierarchyData.battalions.push({
          id: newId,
          label: "New Battalion",
          positions: [
            { id: `${newId}-pos-1`, rank: "O-5", title: "Lieutenant Colonel", closed: false },
            { id: `${newId}-pos-2`, rank: "O-4", title: "Major", closed: false },
          ],
          companies: [],
        });
        renderEditor();
      },
    })
  );

  return section;
}

function renderWarrantOfficers() {
  return el("div", { class: "editor-unit" }, [
    el("div", { class: "editor-unit__header" }, [el("strong", { text: "Warrant Officers" })]),
    renderNamedPositionsList(hierarchyData.warrantOfficers.positions),
  ]);
}

function renderReserves() {
  return el("div", { class: "editor-unit" }, [
    el("div", { class: "editor-unit__header" }, [el("strong", { text: "Reserves" })]),
    renderNamedPositionsList(hierarchyData.reserves.positions),
  ]);
}

document.getElementById("save-hierarchy").addEventListener("click", async () => {
  const status = document.getElementById("save-status");
  status.textContent = "Saving…";
  try {
    await apiFetch("/api/hierarchy", {
      method: "PUT",
      body: { hierarchy: hierarchyData, summary: "Edited via Admin panel" },
    });
    status.textContent = "Saved.";
    setTimeout(() => (status.textContent = ""), 3000);
  } catch (err) {
    status.textContent = "Error: " + err.message;
  }
});

loadOfficers();
loadHierarchy();
populateNewOfficerSeats();
