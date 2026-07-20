/* ===================================================================
   DEPARTMENTS ROSTER VIEW
   Renders 9 department cards and allows adding members to each card.
   Data is stored in localStorage so the page works immediately without
   a backend change.
   =================================================================== */

const GAME_DEPARTMENT_NAMES = [
  "SQUAD",
  "ENLISTED",
  "HELLDIVERS 2",
  "HELL LET LOOSE",
  "WAR THUNDER",
  "BATTLEFIELD"
];

const MAINTENANCE_DEPARTMENT_NAMES = [
  "LOGISTICS (TECH)",
  "MEDIA",
  "SQUAD SERVER"
];

const DEPARTMENT_NAMES = [...GAME_DEPARTMENT_NAMES, ...MAINTENANCE_DEPARTMENT_NAMES];

const DEPARTMENT_DEFAULTS = {
  BATTLEFIELD: [
    { name: "Curry", rank: "Captain" },
    { name: "Alex", rank: "Lieutenant" }
  ],
  "WAR THUNDER": [
    { name: "Kenobi", rank: "Captain" }
  ],
  "HELLDIVERS 2": [
    { name: "Yukki", rank: "Captain" }
  ],
  ENLISTED: [
    { name: "Gatto", rank: "Lieutenant" }
  ],
  SQUAD: [
    { name: "SpaceBall", rank: "Lieutenant" }
  ],
  "HELL LET LOOSE": [],
  "LOGISTICS (TECH)": [],
  MEDIA: [],
  "SQUAD SERVER": []
};

const STORAGE_KEY = "command-hub-departments";

function loadDepartments() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return structuredClone(DEPARTMENT_DEFAULTS);
    const parsed = JSON.parse(raw);
    return normalizeDepartments(parsed);
  } catch (err) {
    console.error("Could not load department data", err);
    return structuredClone(DEPARTMENT_DEFAULTS);
  }
}

function normalizeDepartments(data) {
  const departments = {};
  for (const name of DEPARTMENT_NAMES) {
    const existing = Array.isArray(data?.[name]) ? data[name] : [];
    departments[name] = existing
      .filter((member) => member && typeof member === "object")
      .map((member) => ({
        name: String(member.name || "").trim(),
        rank: String(member.rank || "Member").trim() || "Member"
      }))
      .filter((member) => member.name);
  }
  return departments;
}

function saveDepartments(departments) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(departments));
}

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined) continue;
    if (key === "class") node.className = value;
    else if (key === "text") node.textContent = value;
    else node.setAttribute(key, value);
  }
  for (const child of [].concat(children)) {
    if (child) node.appendChild(child);
  }
  return node;
}

function createDepartmentCard(name, members, onAdd, onEdit, onRemove) {
  const card = el("article", { class: "dept-card" }, [
    el("div", { class: "dept-card__header" }, [
      el("h2", { text: name }),
      el("button", { class: "dept-card__button", type: "button", text: "Add Member" })
    ]),
    el("table", { class: "dept-table" }, [
      el("thead", {}, [
        el("tr", {}, [
          el("th", { text: "Rank" }),
          el("th", { text: "Name" }),
          el("th", { text: "" })
        ])
      ]),
      el("tbody", {}, members.length > 0
        ? members.map((member, index) => el("tr", {}, [
            el("td", { class: "dept-table__rank", text: member.rank || "Member" }),
            el("td", { class: "dept-table__name", text: member.name }),
            el("td", {}, [
              el("div", { class: "dept-table__actions" }, [
                el("button", {
                  class: "dept-table__edit",
                  type: "button",
                  text: "Edit"
                }),
                el("button", {
                  class: "dept-table__delete",
                  type: "button",
                  text: "Delete"
                })
              ])
            ])
          ]))
        : [el("tr", {}, [el("td", { class: "dept-table__empty", colspan: "3", text: "No members assigned yet." })])])
    ])
  ]);

  const button = card.querySelector(".dept-card__button");
  button.addEventListener("click", () => onAdd(name));

  card.querySelectorAll(".dept-table__edit").forEach((editButton, index) => {
    editButton.addEventListener("click", () => onEdit(name, index));
  });

  card.querySelectorAll(".dept-table__delete").forEach((deleteButton, index) => {
    deleteButton.addEventListener("click", () => onRemove(name, index));
  });

  return card;
}

function createModal(departmentName, initialMember, onSubmit) {
  const backdrop = el("div", { class: "dept-modal-backdrop" }, [
    el("div", { class: "dept-modal" }, [
      el("h3", { text: initialMember ? `Edit member in ${departmentName}` : `Add member to ${departmentName}` }),
      el("form", { class: "dept-form" }, [
        el("div", { class: "dept-field" }, [
          el("label", { for: "dept-member-name", text: "Name" }),
          el("input", { id: "dept-member-name", name: "name", type: "text", required: true, value: initialMember?.name || "" })
        ]),
        el("div", { class: "dept-field" }, [
          el("label", { for: "dept-member-rank", text: "Rank" }),
          el("input", { id: "dept-member-rank", name: "rank", type: "text", value: initialMember?.rank || "Member" })
        ]),
        el("div", { class: "dept-modal__actions" }, [
          el("button", { type: "button", text: "Cancel" }),
          el("button", { type: "submit", text: initialMember ? "Save Changes" : "Save Member" })
        ])
      ])
    ])
  ]);

  const form = backdrop.querySelector(".dept-form");
  const cancel = backdrop.querySelector("button[type='button']");
  cancel.addEventListener("click", () => backdrop.remove());

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const formData = new FormData(form);
    const member = {
      name: String(formData.get("name") || "").trim(),
      rank: String(formData.get("rank") || "Member").trim() || "Member"
    };
    if (!member.name) return;
    onSubmit(member);
    backdrop.remove();
  });

  return backdrop;
}

function renderDepartments(root, departments) {
  const gameGrid = el("div", { class: "dept-grid" });
  const maintenanceGrid = el("div", { class: "dept-grid" });

  const renderSection = (names, grid) => {
    for (const name of names) {
      const members = departments[name] || [];
      const card = createDepartmentCard(
        name,
        members,
        (departmentName) => {
          const modal = createModal(departmentName, null, (member) => {
            const updated = loadDepartments();
            updated[departmentName] = [...(updated[departmentName] || []), member];
            saveDepartments(updated);
            renderDepartments(root, updated);
          });
          root.appendChild(modal);
        },
        (departmentName, memberIndex) => {
          const updated = loadDepartments();
          const member = updated[departmentName]?.[memberIndex];
          if (!member) return;
          const modal = createModal(departmentName, member, (updatedMember) => {
            const next = loadDepartments();
            next[departmentName] = [...(next[departmentName] || [])];
            next[departmentName][memberIndex] = updatedMember;
            saveDepartments(next);
            renderDepartments(root, next);
          });
          root.appendChild(modal);
        },
        (departmentName, memberIndex) => {
          const updated = loadDepartments();
          const list = [...(updated[departmentName] || [])];
          list.splice(memberIndex, 1);
          updated[departmentName] = list;
          saveDepartments(updated);
          renderDepartments(root, updated);
        }
      );
      grid.appendChild(card);
    }
  };

  renderSection(GAME_DEPARTMENT_NAMES, gameGrid);
  renderSection(MAINTENANCE_DEPARTMENT_NAMES, maintenanceGrid);

  const content = el("div", {}, [
    el("div", { class: "page-heading" }, [
      el("div", {}, [
        el("h1", { class: "page-title", text: "Departments" }),
        el("p", { class: "page-subtitle", text: "A roster view for each department with quick member additions." })
      ]),
      el("button", { class: "pill-button", type: "button", text: "Reset demo data" })
    ]),
    el("div", { class: "dept-section" }, [
      el("h2", { class: "dept-section__title", text: "Game Departments" }),
      gameGrid
    ]),
    el("div", { class: "dept-section" }, [
      el("h2", { class: "dept-section__title", text: "Maintenance Departments" }),
      maintenanceGrid
    ])
  ]);

  root.replaceChildren(content);

  const resetButton = root.querySelector(".pill-button");
  resetButton?.addEventListener("click", () => {
    saveDepartments(structuredClone(DEPARTMENT_DEFAULTS));
    renderDepartments(root, loadDepartments());
  });
}

function init() {
  const root = document.getElementById("departments-root");
  if (!root) return;
  renderDepartments(root, loadDepartments());
}

init();
