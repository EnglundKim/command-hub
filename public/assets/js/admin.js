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

/* ---------------- Officers ---------------- */

async function loadOfficers() {
  const callout = document.getElementById("officer-callout");
  const body = document.getElementById("officers-body");
  body.innerHTML = "";
  try {
    const { officers } = await apiFetch("/api/officers");
    officers.forEach((o) => {
      body.appendChild(
        el("tr", {}, [
          el("td", { text: o.username }),
          el("td", { text: o.email }),
          el("td", { text: o.tier.replace("_", " ") }),
          el("td", { text: o.created_at }),
          el("td", {}, [
            el("button", {
              class: "admin-btn admin-btn--danger admin-btn--small",
              text: "Remove",
              onclick: () => removeOfficer(o.id, o.username),
            }),
          ]),
        ])
      );
    });
  } catch (err) {
    callout.appendChild(el("div", { class: "auth-message auth-message--error", text: err.message }));
  }
}

async function removeOfficer(id, username) {
  if (!confirm(`Remove officer "${username}"? This can't be undone.`)) return;
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
  const email = document.getElementById("new-email").value.trim();
  const tier = document.getElementById("new-tier").value;

  try {
    const res = await apiFetch("/api/officers", { method: "POST", body: { username, email, tier } });
    callout.appendChild(
      el("div", { class: "admin-callout" }, [
        document.createTextNode(`Account created. Temporary password (share this with ${username} — it won't be shown again): `),
        el("code", { text: res.tempPassword }),
      ])
    );
    e.target.reset();
    loadOfficers();
  } catch (err) {
    callout.appendChild(el("div", { class: "auth-message auth-message--error", text: err.message }));
  }
});

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

function rankSelectWithPreview(pos) {
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

function renderPositionsList(positions) {
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
    renderPositionsList(hierarchyData.regiment.positions),
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
    renderPositionsList(company.positions),
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
      renderPositionsList(battalion.positions),
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
            battalion.companies = battalion.companies || [];
            battalion.companies.push({
              id: `co-${Date.now()}`,
              label: "New Company",
              positions: [{ rank: "O-3", title: "Captain", status: "vacant" }],
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
        hierarchyData.battalions.push({
          id: `bn-${Date.now()}`,
          label: "New Battalion",
          positions: [
            { rank: "O-5", title: "Lieutenant Colonel", status: "vacant" },
            { rank: "O-4", title: "Major", status: "vacant" },
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
    renderPositionsList(hierarchyData.warrantOfficers.positions),
  ]);
}

function renderReserves() {
  return el("div", { class: "editor-unit" }, [
    el("div", { class: "editor-unit__header" }, [el("strong", { text: "Reserves" })]),
    renderPositionsList(hierarchyData.reserves.positions),
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
