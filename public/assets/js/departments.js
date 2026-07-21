/* ===================================================================
   DEPARTMENTS ROSTER VIEW
   Renders department cards and allows adding members to each card.
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
  BATTLEFIELD: [],
  "WAR THUNDER": [],
  "HELLDIVERS 2": [],
  ENLISTED: [],
  SQUAD: [],
  "HELL LET LOOSE": [],
  "LOGISTICS (TECH)": [],
  MEDIA: [],
  "SQUAD SERVER": []
};

const DEFAULT_CATEGORY_MAP = Object.fromEntries(
  DEPARTMENT_NAMES.map((name) => [
    name,
    GAME_DEPARTMENT_NAMES.includes(name) ? "game" : "maintenance"
  ])
);

const STORAGE_KEY = "command-hub-departments";

const FALLBACK_OFFICER_NAMES = [
  "Curry",
  "Hombrger",
  "Kenobi",
  "Connie",
  "Yukki",
  "SpaceBall",
  "Alex",
  "Gatto"
];

const DEFAULT_STATE = {
  departments: structuredClone(DEPARTMENT_DEFAULTS),
  categoryMap: structuredClone(DEFAULT_CATEGORY_MAP)
};

function loadDepartments() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return structuredClone(DEFAULT_STATE);
    const parsed = JSON.parse(raw);
    return normalizeState(parsed);
  } catch (err) {
    console.error("Could not load department data", err);
    return structuredClone(DEFAULT_STATE);
  }
}

function buildCategoryMapFromData(data) {
  const categoryMap = {};
  if (!data || typeof data !== "object") return categoryMap;
  for (const name of Object.keys(data)) {
    if (GAME_DEPARTMENT_NAMES.includes(name)) categoryMap[name] = "game";
    else if (MAINTENANCE_DEPARTMENT_NAMES.includes(name)) categoryMap[name] = "maintenance";
    else categoryMap[name] = "game";
  }
  return categoryMap;
}

function normalizeDepartments(data) {
  const departments = {};
  for (const name of Object.keys(data || {})) {
    const existing = Array.isArray(data[name]) ? data[name] : [];
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

function normalizeState(state) {
  if (!state || typeof state !== "object") return structuredClone(DEFAULT_STATE);

  const rawDepartments = state.departments && typeof state.departments === "object"
    ? state.departments
    : state;

  const departments = normalizeDepartments(rawDepartments);
  if (Object.keys(departments).length === 0) return structuredClone(DEFAULT_STATE);

  const categoryMap = {};
  for (const name of Object.keys(departments)) {
    categoryMap[name] = state.categoryMap?.[name]
      || buildCategoryMapFromData(rawDepartments)[name]
      || "game";
  }

  return {
    departments,
    categoryMap
  };
}

function saveDepartments(state) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
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

function getDepartmentNames(category, departments, categoryMap) {
  const names = Object.keys(departments).filter((name) => categoryMap[name] === category);
  const defaultNames = category === "game" ? GAME_DEPARTMENT_NAMES : MAINTENANCE_DEPARTMENT_NAMES;
  const orderedDefaults = defaultNames.filter((name) => names.includes(name));
  const extras = names
    .filter((name) => !defaultNames.includes(name))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  return [...orderedDefaults, ...extras];
}

function createDepartmentCard(name, members, onAdd, onEditMember, onRemoveMember, onEditDepartment, onDeleteDepartment) {
  const card = el("article", { class: "dept-card" }, [
    el("div", { class: "dept-card__header" }, [
      el("h2", { text: name }),
      el("div", { class: "dept-card__header-actions" }, [
        el("button", {
          class: "dept-card__small-button",
          type: "button",
          text: "Edit"
        }),
        el("button", {
          class: "dept-card__small-button dept-card__small-button--danger",
          type: "button",
          text: "Delete"
        }),
        el("button", {
          class: "dept-card__button",
          type: "button",
          text: "Add Member"
        })
      ])
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
        : [el("tr", {}, [el("td", { class: "dept-table__empty", colspan: "3", text: "No staff assigned yet." })])])
    ])
  ]);

  card.querySelector(".dept-card__header-actions button:nth-child(1)")
    .addEventListener("click", () => onEditDepartment(name));
  card.querySelector(".dept-card__header-actions button:nth-child(2)")
    .addEventListener("click", () => onDeleteDepartment(name));
  card.querySelector(".dept-card__button")
    .addEventListener("click", () => onAdd(name));

  card.querySelectorAll(".dept-table__edit").forEach((editButton, index) => {
    editButton.addEventListener("click", () => onEditMember(name, index));
  });

  card.querySelectorAll(".dept-table__delete").forEach((deleteButton, index) => {
    deleteButton.addEventListener("click", () => onRemoveMember(name, index));
  });

  return card;
}

async function loadOfficerNames() {
  try {
    const data = await apiFetch("/api/officers");
    const officers = Array.isArray(data?.officers) ? data.officers : [];
    const names = officers
      .map((officer) => String(officer.display_name || officer.username || "").trim())
      .filter(Boolean);
    if (names.length > 0) return names;
  } catch (err) {
    console.error("Could not load officer roster", err);
  }

  return FALLBACK_OFFICER_NAMES;
}

function createMemberModal(departmentName, initialMember, onSubmit) {
  const backdrop = el("div", { class: "dept-modal-backdrop" }, [
    el("div", { class: "dept-modal" }, [
      el("h3", { text: initialMember ? `Edit member in ${departmentName}` : `Add member to ${departmentName}` }),
      el("form", { class: "dept-form" }, [
        el("div", { class: "dept-field" }, [
          el("label", { for: "dept-member-name", text: "Officer" }),
          el("select", { id: "dept-member-name", name: "name", required: true }, [
            el("option", { value: "", text: "Loading officers..." })
          ])
        ]),
        el("div", { class: "dept-field" }, [
          el("label", { for: "dept-member-rank", text: "Rank" }),
          el("select", { id: "dept-member-rank", name: "rank" }, [
            el("option", { value: "DEPARTMENT CO", text: "DEPARTMENT CO" }),
            el("option", { value: "DEPARTMENT XO", text: "DEPARTMENT XO" }),
            el("option", { value: "ASSISTING STAFF", text: "ASSISTING STAFF" })
          ])
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
  const rankSelect = backdrop.querySelector("select[name='rank']");
  const nameSelect = backdrop.querySelector("select[name='name']");
  if (rankSelect && initialMember?.rank) {
    rankSelect.value = initialMember.rank;
  }
  cancel.addEventListener("click", () => backdrop.remove());

  loadOfficerNames().then((officerNames) => {
    if (!nameSelect) return;
    const uniqueNames = officerNames.filter((name, index, list) => list.indexOf(name) === index);
    const options = uniqueNames.map((name) => el("option", { value: name, text: name }));
    const selectedName = initialMember?.name || "";
    const currentValue = uniqueNames.includes(selectedName) ? selectedName : selectedName || "";

    nameSelect.replaceChildren(
      el("option", { value: "", text: "Select officer" }),
      ...options,
      ...(selectedName && !uniqueNames.includes(selectedName)
        ? [el("option", { value: selectedName, text: `${selectedName} (current value)` })]
        : [])
    );

    if (currentValue) {
      nameSelect.value = currentValue;
    }
  });

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const formData = new FormData(form);
    const member = {
      name: String(formData.get("name") || "").trim(),
      rank: String(formData.get("rank") || "DEPARTMENT CO").trim() || "DEPARTMENT CO"
    };
    if (!member.name) return;
    onSubmit(member);
    backdrop.remove();
  });

  return backdrop;
}

function createDepartmentModal(initialName, initialCategory, onSubmit) {
  const backdrop = el("div", { class: "dept-modal-backdrop" }, [
    el("div", { class: "dept-modal" }, [
      el("h3", { text: initialName ? `Edit department ${initialName}` : "Add department" }),
      el("form", { class: "dept-form" }, [
        el("div", { class: "dept-field" }, [
          el("label", { for: "dept-name", text: "Department Name" }),
          el("input", {
            id: "dept-name",
            name: "name",
            type: "text",
            required: true,
            value: initialName || ""
          })
        ]),
        el("div", { class: "dept-field" }, [
          el("label", { for: "dept-category", text: "Category" }),
          el("select", { id: "dept-category", name: "category" }, [
            el("option", { value: "game", text: "Game Department" }),
            el("option", { value: "maintenance", text: "Maintenance Department" })
          ])
        ]),
        el("div", { class: "dept-modal__actions" }, [
          el("button", { type: "button", text: "Cancel" }),
          el("button", { type: "submit", text: initialName ? "Save Changes" : "Save Department" })
        ])
      ])
    ])
  ]);

  const form = backdrop.querySelector(".dept-form");
  const cancel = backdrop.querySelector("button[type='button']");
  const select = backdrop.querySelector("select[name='category']");
  if (initialCategory) select.value = initialCategory;
  cancel.addEventListener("click", () => backdrop.remove());

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const formData = new FormData(form);
    const dept = {
      name: String(formData.get("name") || "").trim(),
      category: String(formData.get("category") || "game")
    };
    if (!dept.name) return;
    onSubmit(dept);
    backdrop.remove();
  });

  return backdrop;
}

function renderDepartments(root, state) {
  const { departments, categoryMap } = state;
  const gameGrid = el("div", { class: "dept-grid" });
  const maintenanceGrid = el("div", { class: "dept-grid" });

  const renderSection = (category, grid) => {
    const names = getDepartmentNames(category, departments, categoryMap);
    for (const name of names) {
      const members = departments[name] || [];
      const card = createDepartmentCard(
        name,
        members,
        (departmentName) => {
          const modal = createMemberModal(departmentName, null, (member) => {
            const current = loadDepartments();
            current.departments[departmentName] = [...(current.departments[departmentName] || []), member];
            saveDepartments(current);
            renderDepartments(root, current);
          });
          root.appendChild(modal);
        },
        (departmentName, memberIndex) => {
          const current = loadDepartments();
          const member = current.departments[departmentName]?.[memberIndex];
          if (!member) return;
          const modal = createMemberModal(departmentName, member, (updatedMember) => {
            const next = loadDepartments();
            next.departments[departmentName] = [...(next.departments[departmentName] || [])];
            next.departments[departmentName][memberIndex] = updatedMember;
            saveDepartments(next);
            renderDepartments(root, next);
          });
          root.appendChild(modal);
        },
        (departmentName, memberIndex) => {
          const current = loadDepartments();
          const list = [...(current.departments[departmentName] || [])];
          list.splice(memberIndex, 1);
          current.departments[departmentName] = list;
          saveDepartments(current);
          renderDepartments(root, current);
        },
        (departmentName) => {
          const current = loadDepartments();
          const modal = createDepartmentModal(departmentName, current.categoryMap[departmentName] || "game", (updatedDepartment) => {
            const updatedName = updatedDepartment.name;
            if (updatedName !== departmentName && current.departments[updatedName]) {
              alert("A department with that name already exists.");
              return;
            }
            const members = current.departments[departmentName] || [];
            delete current.departments[departmentName];
            delete current.categoryMap[departmentName];
            current.departments[updatedName] = members;
            current.categoryMap[updatedName] = updatedDepartment.category;
            saveDepartments(current);
            renderDepartments(root, current);
          });
          root.appendChild(modal);
        },
        (departmentName) => {
          if (!confirm(`Delete department "${departmentName}" and all its members? This cannot be undone.`)) return;
          const current = loadDepartments();
          delete current.departments[departmentName];
          delete current.categoryMap[departmentName];
          saveDepartments(current);
          renderDepartments(root, current);
        }
      );
      grid.appendChild(card);
    }
  };

  renderSection("game", gameGrid);
  renderSection("maintenance", maintenanceGrid);

  const createSection = (title, category, grid) => el("div", { class: "dept-section" }, [
    el("div", { class: "dept-section__header" }, [
      el("h2", { class: "dept-section__title", text: title }),
      el("button", {
        class: "dept-section__button",
        type: "button",
        text: `Add ${category === "game" ? "Game" : "Maintenance"} Department`
      })
    ]),
    grid
  ]);

  const content = el("div", {}, [
    el("div", { class: "page-heading" }, [
      el("div", {}, [
        el("h1", { class: "page-title", text: "Departments" }),
        el("p", { class: "page-subtitle", text: "A roster view for each department." })
      ])
    ]),
    createSection("Game Departments", "game", gameGrid),
    createSection("Maintenance Departments", "maintenance", maintenanceGrid)
  ]);

  root.replaceChildren(content);

  root.querySelectorAll(".dept-section__button").forEach((button) => {
    button.addEventListener("click", () => {
      const category = button.textContent?.includes("Game") ? "game" : "maintenance";
      const modal = createDepartmentModal("", category, (department) => {
        const current = loadDepartments();
        if (current.departments[department.name]) {
          alert("A department with that name already exists.");
          return;
        }
        current.departments[department.name] = [];
        current.categoryMap[department.name] = department.category;
        saveDepartments(current);
        renderDepartments(root, current);
      });
      root.appendChild(modal);
    });
  });
}

function init() {
  const root = document.getElementById("departments-root");
  if (!root) return;
  renderDepartments(root, loadDepartments());
}

init();
