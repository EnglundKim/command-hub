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

const RATING_COLORS = {
  5: "#3aa655",
  4: "#8bc34a",
  3: "#f6c343",
  2: "#f0973b",
  1: "#e2683a",
  0: "#e5484d",
  LOA: "#ebae46",
};
const RATING_LABELS = {
  5: "Exemplary",
  4: "Impressive",
  3: "Consistent",
  2: "Moderate",
  1: "Poor",
  0: "Inactive",
  LOA: "Leave of Absence",
};

let viewedDate = new Date();
let activityData = null;

function viewedYearMonth() {
  return { year: viewedDate.getUTCFullYear(), month: viewedDate.getUTCMonth() + 1 };
}

function formatMonthYear(year, month) {
  return new Date(Date.UTC(year, month - 1, 1)).toLocaleString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

function formatWeekLabel(iso) {
  const d = new Date(iso + "T00:00:00Z");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

async function loadActivity() {
  const { year, month } = viewedYearMonth();
  const monthParam = `${year}-${String(month).padStart(2, "0")}`;
  const root = document.getElementById("activity-root");
  root.innerHTML = "Loading&hellip;";

  try {
    activityData = await apiFetch(`/api/activity?month=${monthParam}`);
    renderGrid();
  } catch (err) {
    root.innerHTML = "";
    root.appendChild(el("p", { class: "auth-message auth-message--error", text: err.message }));
  }
  updateNav();
}

function updateNav() {
  const { year, month } = viewedYearMonth();
  document.getElementById("month-label").textContent = formatMonthYear(year, month);
  const now = new Date();
  const isCurrentMonth = year === now.getUTCFullYear() && month === now.getUTCMonth() + 1;
  document.getElementById("next-month").disabled = isCurrentMonth;
}

document.getElementById("prev-month").addEventListener("click", () => {
  viewedDate = new Date(Date.UTC(viewedDate.getUTCFullYear(), viewedDate.getUTCMonth() - 1, 1));
  loadActivity();
});
document.getElementById("next-month").addEventListener("click", () => {
  viewedDate = new Date(Date.UTC(viewedDate.getUTCFullYear(), viewedDate.getUTCMonth() + 1, 1));
  loadActivity();
});

function renderGrid() {
  const root = document.getElementById("activity-root");
  root.innerHTML = "";

  if (!activityData.rows.length) {
    root.appendChild(
      el("p", { class: "auth-message", style: "display:block;", text: "No one visible to you has an assigned seat yet." })
    );
    return;
  }

  const table = el("table", { class: "activity-table" }, [
    el("thead", {}, [
      el("tr", {}, [
        el("th", { text: "Officer" }),
        ...activityData.weeks.map((w) => el("th", { text: formatWeekLabel(w) })),
        el("th", { text: `Qtr Avg (${activityData.quarterLabel})` }),
      ]),
    ]),
    el("tbody", {}, activityData.rows.map(renderRow)),
  ]);

  root.appendChild(table);
}

function renderRow(row) {
  const nameCell = el("td", { class: "activity-name-cell" }, [
    RANK_ICONS[row.rank] ? el("img", { class: "coc-row__insignia", src: RANK_ICONS[row.rank], alt: row.rank }) : null,
    el("div", {}, [
      el("div", { class: "activity-name", text: row.displayName }),
      el("div", { class: "activity-sub", text: `${row.unitLabel} — ${row.title}` }),
    ]),
  ]);

  const weekCells = activityData.weeks.map((week) => {
    const value = row.ratings[week];
    if (week === activityData.currentWeek && row.canRate) {
      return el("td", {}, [renderEditableCell(row, week, value)]);
    }
    return el("td", {}, [renderReadonlyCell(value)]);
  });

  const avgCell = el("td", { class: "activity-avg", text: row.qtrAvg === null ? "—" : row.qtrAvg.toFixed(1) });

  return el("tr", {}, [nameCell, ...weekCells, avgCell]);
}

function renderReadonlyCell(value) {
  if (!value) return el("span", { class: "activity-cell activity-cell--empty", text: "—" });
  const badge = el("span", { class: "activity-cell", text: value });
  badge.style.backgroundColor = RATING_COLORS[value];
  return badge;
}

function renderEditableCell(row, week, value) {
  const select = el(
    "select",
    {
      class: "activity-select",
      onchange: async (e) => {
        const newValue = e.target.value;
        try {
          await apiFetch("/api/activity/rating", {
            method: "PUT",
            body: { targetOfficerId: row.officerId, weekStart: week, rating: newValue },
          });
          select.style.backgroundColor = RATING_COLORS[newValue] || "";
        } catch (err) {
          alert(err.message);
          select.value = value || "";
        }
      },
    },
    [
      el("option", { value: "", text: "—", selected: !value ? "selected" : null }),
      ...["5", "4", "3", "2", "1", "0", "LOA"].map((v) =>
        el("option", {
          value: v,
          text: v === "LOA" ? "LOA" : `${v} — ${RATING_LABELS[v]}`,
          selected: value === v ? "selected" : null,
        })
      ),
    ]
  );
  if (value) select.style.backgroundColor = RATING_COLORS[value];
  return select;
}

loadActivity();
