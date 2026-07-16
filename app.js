const state = {
  rows: [],
  columns: [],
  fileName: "",
  sheetName: "",
  mapping: {},
  filters: {
    team: "",
    status: "",
    changeType: "",
    riskLevel: "",
  },
  analysis: null,
  currentDetails: [],
  currentDetailsTitle: "",
};

const els = {
  fileInput: document.getElementById("fileInput"),
  uploadForm: document.getElementById("uploadForm"),
  fileMeta: document.getElementById("fileMeta"),
  mappingPanel: document.getElementById("mappingPanel"),
  filterPanel: document.getElementById("filterPanel"),
  rowCount: document.getElementById("rowCount"),
  filteredRowCount: document.getElementById("filteredRowCount"),
  emptyState: document.getElementById("emptyState"),
  dashboardContent: document.getElementById("dashboardContent"),
  exportPdf: document.getElementById("exportPdf"),
  exportReport: document.getElementById("exportReport"),
  resetData: document.getElementById("resetData"),
  totalChanges: document.getElementById("totalChanges"),
  completedChanges: document.getElementById("completedChanges"),
  onTimeRate: document.getElementById("onTimeRate"),
  overdueChanges: document.getElementById("overdueChanges"),
  lateSubmissionTotal: document.getElementById("lateSubmissionTotal"),
  timelineRange: document.getElementById("timelineRange"),
  timelineChart: document.getElementById("timelineChart"),
  teamVolumeChart: document.getElementById("teamVolumeChart"),
  notCompletedTeamChart: document.getElementById("notCompletedTeamChart"),
  lateSubmissionChart: document.getElementById("lateSubmissionChart"),
  onTimeChart: document.getElementById("onTimeChart"),
  statusChart: document.getElementById("statusChart"),
  changeTypeChart: document.getElementById("changeTypeChart"),
  riskLevelChart: document.getElementById("riskLevelChart"),
  teamReportBody: document.getElementById("teamReportBody"),
  delayedBody: document.getElementById("delayedBody"),
  detailPanel: document.getElementById("detailPanel"),
  detailTitle: document.getElementById("detailTitle"),
  detailSummary: document.getElementById("detailSummary"),
  detailBody: document.getElementById("detailBody"),
  closeDetails: document.getElementById("closeDetails"),
  exportDetails: document.getElementById("exportDetails"),
  reportSummary: document.getElementById("reportSummary"),
  primaryFinding: document.getElementById("primaryFinding"),
  timelineFinding: document.getElementById("timelineFinding"),
  qualityFinding: document.getElementById("qualityFinding"),
};

const selects = {
  team: document.getElementById("teamColumn"),
  status: document.getElementById("statusColumn"),
  changeType: document.getElementById("changeTypeColumn"),
  riskLevel: document.getElementById("riskLevelColumn"),
  plannedStart: document.getElementById("plannedStartColumn"),
  plannedEnd: document.getElementById("plannedEndColumn"),
  actualStart: document.getElementById("actualStartColumn"),
  completedDate: document.getElementById("completedDateColumn"),
  submittedDate: document.getElementById("submittedDateColumn"),
  id: document.getElementById("idColumn"),
  title: document.getElementById("titleColumn"),
};

const filters = {
  team: document.getElementById("teamFilter"),
  status: document.getElementById("statusFilter"),
  changeType: document.getElementById("changeTypeFilter"),
  riskLevel: document.getElementById("riskLevelFilter"),
};

const fieldHints = {
  team: ["assignment group", "team", "group", "owner team", "assigned team", "resolver group", "department", "workstream", "squad"],
  status: ["status", "state", "phase", "change status", "implementation status", "closure status"],
  changeType: ["change type", "type", "request type", "issue type", "category", "change category"],
  riskLevel: ["change risk", "change risk level", "risk level", "risk", "risk rating", "risk category", "risk score"],
  plannedStart: ["planned start date", "planned start", "planned begin", "scheduled start", "target start", "baseline start", "plan start"],
  plannedEnd: ["planned end", "planned finish", "planned completion", "target end", "target finish", "due date", "scheduled end", "baseline end", "plan end", "planned implementation end"],
  actualStart: ["change start date", "actual start", "started", "start date", "implementation start", "actual begin"],
  completedDate: ["change completion date", "completed", "completion date", "actual completion", "actual completed", "actual end", "actual finish", "closed date", "implemented date", "deployment date", "finish date"],
  submittedDate: ["submitted date", "submission date", "submitted", "created", "created date", "date created", "request date", "requested date", "opened", "opened date", "raised date", "logged date"],
  id: ["key", "change id", "change number", "id", "ticket", "request", "reference", "change request"],
  title: ["summary", "title", "description", "change title", "short description", "name"],
};

const completeWords = ["complete", "completed", "closed", "done", "implemented", "deployed", "finished", "resolved"];
const cancelledWords = ["cancelled", "canceled", "rejected", "withdrawn", "deferred", "duplicate"];
const statusWords = ["implementing", "planning", "approval", "authorize", "awaiting", "complete", "completed", "closed", "open", "resolved", "cancelled", "canceled"];
const today = startOfDay(new Date());

els.fileInput.addEventListener("change", () => {
  const file = els.fileInput.files?.[0];
  if (file) uploadFile(file);
});

["dragenter", "dragover"].forEach((eventName) => {
  els.uploadForm.addEventListener(eventName, (event) => {
    event.preventDefault();
    els.uploadForm.classList.add("is-dragging");
  });
});

["dragleave", "drop"].forEach((eventName) => {
  els.uploadForm.addEventListener(eventName, (event) => {
    event.preventDefault();
    els.uploadForm.classList.remove("is-dragging");
  });
});

els.uploadForm.addEventListener("drop", (event) => {
  const file = event.dataTransfer?.files?.[0];
  if (file) uploadFile(file);
});

Object.values(selects).forEach((select) => {
  select.addEventListener("change", () => {
    state.mapping = readMapping();
    renderAnalysis();
  });
});

Object.values(filters).forEach((select) => {
  select.addEventListener("change", () => {
    state.filters = readFilters();
    renderAnalysis();
  });
});

els.exportReport.addEventListener("click", exportTeamReport);
els.exportPdf.addEventListener("click", exportExecutivePptx);
els.resetData.addEventListener("click", resetData);
document.getElementById("clearFilters").addEventListener("click", clearDashboardFilters);
els.closeDetails.addEventListener("click", () => hideDetails(true));
els.exportDetails.addEventListener("click", exportVisibleDetails);

document.addEventListener("click", (event) => {
  const trigger = event.target.closest("[data-drilldown]");
  if (!trigger) return;
  const filter = decodeFilter(trigger.dataset.drilldown);
  if (!filter) return;
  showDrilldown(filter);
});

document.addEventListener("keydown", (event) => {
  if (!["Enter", " "].includes(event.key)) return;
  const trigger = event.target.closest("[data-drilldown]");
  if (!trigger) return;
  event.preventDefault();
  const filter = decodeFilter(trigger.dataset.drilldown);
  if (filter) showDrilldown(filter);
});

async function uploadFile(file) {
  setLoading(file.name);
  const formData = new FormData();
  formData.append("file", file);

  try {
    const response = await fetch("/api/parse", { method: "POST", body: formData });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "The file could not be parsed.");

    state.rows = payload.rows || [];
    state.columns = payload.columns || [];
    state.fileName = payload.fileName || file.name;
    state.sheetName = payload.sheetName || "";
    state.mapping = detectMapping(state.columns, state.rows);
    populateMapping();
    els.fileMeta.textContent = [state.fileName, state.sheetName].filter(Boolean).join(" · ");
    els.rowCount.textContent = `${formatNumber(state.rows.length)} rows`;
    els.mappingPanel.classList.remove("is-disabled");
    els.filterPanel.classList.remove("is-disabled");
    els.resetData.disabled = false;
    els.exportReport.disabled = false;
    els.exportPdf.disabled = false;
    renderAnalysis();
  } catch (error) {
    resetData();
    els.fileMeta.textContent = error.message;
    els.primaryFinding.textContent = error.message;
  }
}

function setLoading(fileName) {
  els.fileMeta.textContent = `Reading ${fileName}`;
  els.mappingPanel.classList.add("is-disabled");
  els.exportReport.disabled = true;
  els.exportPdf.disabled = true;
}

function resetData() {
  state.rows = [];
  state.columns = [];
  state.fileName = "";
  state.sheetName = "";
  state.mapping = {};
  state.filters = { team: "", status: "", changeType: "", riskLevel: "" };
  state.analysis = null;
  state.currentDetails = [];
  state.currentDetailsTitle = "";
  els.fileInput.value = "";
  els.fileMeta.textContent = "CSV, TSV, or XLSX";
  els.rowCount.textContent = "No data";
  els.filteredRowCount.textContent = "All rows";
  els.mappingPanel.classList.add("is-disabled");
  els.filterPanel.classList.add("is-disabled");
  if (els.emptyState) els.emptyState.hidden = true;
  els.dashboardContent.hidden = true;
  els.detailPanel.hidden = true;
  els.exportReport.disabled = true;
  els.exportPdf.disabled = true;
  els.resetData.disabled = true;
  document.getElementById("clearFilters").disabled = true;
  els.primaryFinding.textContent = "Upload a file to generate portfolio findings.";
  els.timelineFinding.textContent = "";
  els.qualityFinding.textContent = "";
  Object.values(selects).forEach((select) => (select.innerHTML = ""));
  Object.values(filters).forEach((select) => (select.innerHTML = ""));
}

function detectMapping(columns, rows) {
  const mapping = {};
  Object.entries(fieldHints).forEach(([field, hints]) => {
    mapping[field] = findColumn(columns, hints, field, rows);
  });
  return mapping;
}

function findColumn(columns, hints, field, rows) {
  const samples = rows.slice(0, 200);
  let bestColumn = "";
  let bestScore = 0;

  columns.forEach((column) => {
    const columnName = normalize(column).replace(/\s+\d+$/, "");
    const values = samples.map((row) => value(row, column)).filter(Boolean);
    let score = 0;

    hints.forEach((hint) => {
      const hintName = normalize(hint);
      if (columnName === hintName) score += 60;
      else if (columnName.includes(hintName) || hintName.includes(columnName)) score += 24;
    });

    score += (values.length / safeDenominator(samples.length)) * 12;
    if (!values.length) score -= 30;
    score += fieldSpecificScore(field, columnName, values);

    if (score > bestScore) {
      bestScore = score;
      bestColumn = column;
    }
  });

  return bestScore >= 15 ? bestColumn : "";
}

function fieldSpecificScore(field, columnName, values) {
  if (field === "status") {
    const matches = values.filter((item) => hasAnyWord(item, statusWords)).length;
    return (matches / safeDenominator(values.length)) * 45;
  }
  if (field === "team") {
    return columnName.includes("assignment group") ? 35 : 0;
  }
  if (field === "id") {
    return values.some((item) => /^[A-Z]+-\d+/.test(item)) ? 40 : 0;
  }
  if (field === "title") {
    return columnName === "summary" ? 35 : 0;
  }
  if (field === "changeType") {
    return columnName === "change type" || columnName.endsWith("type") ? 35 : 0;
  }
  if (field === "riskLevel") {
    const riskRatio = values.filter((item) => isStandardRiskLevel(item)).length / safeDenominator(values.length);
    return (columnName.includes("risk") ? 42 : 0) + riskRatio * 40;
  }
  if (["plannedStart", "plannedEnd", "actualStart", "completedDate", "submittedDate"].includes(field)) {
    const dateRatio = values.filter((item) => parseDate(item)).length / safeDenominator(values.length);
    let score = dateRatio * 42;
    if (field === "submittedDate") {
      if (["created", "submitted", "submission", "requested", "opened", "raised", "logged"].some((word) => columnName.includes(word))) score += 36;
      if (["complete", "closed", "finish", "planned", "implementation", "updated", "resolved"].some((word) => columnName.includes(word))) score -= 34;
      return score;
    }
    if (field === "plannedStart" && columnName.includes("end")) score -= 45;
    if (field === "plannedEnd" && columnName.includes("start")) score -= 45;
    if (field === "actualStart" && (columnName.includes("completion") || columnName.includes("end"))) score -= 45;
    if (field === "completedDate" && columnName.includes("start")) score -= 45;
    if (field === "completedDate" && columnName.includes("completion")) score += 35;
    return score;
  }
  return 0;
}

function normalize(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function normalizeRiskLevel(value) {
  const text = normalize(value);
  if (!text) return "Unspecified";
  const padded = ` ${text} `;
  if (padded.includes(" high ") || padded.includes(" critical ") || padded.includes(" severe ")) return "High";
  if (padded.includes(" medium ") || padded.includes(" meduim ") || padded.includes(" moderate ") || padded.includes(" med ")) return "Medium";
  if (padded.includes(" low ") || padded.includes(" minor ")) return "Low";
  return String(value || "Unspecified").trim();
}

function isStandardRiskLevel(value) {
  return ["Low", "Medium", "High"].includes(normalizeRiskLevel(value));
}

function isCabSubmissionTrackedChangeType(value) {
  const text = normalize(value);
  return text.includes("normal");
}

function populateMapping() {
  Object.entries(selects).forEach(([key, select]) => {
    select.innerHTML = "";
    select.appendChild(new Option("Not available", ""));
    state.columns.forEach((column) => select.appendChild(new Option(column, column)));
    select.value = state.mapping[key] || "";
  });
}

function readMapping() {
  return Object.fromEntries(Object.entries(selects).map(([key, select]) => [key, select.value]));
}

function readFilters() {
  return Object.fromEntries(Object.entries(filters).map(([key, select]) => [key, select.value]));
}

function clearDashboardFilters() {
  state.filters = { team: "", status: "", changeType: "", riskLevel: "" };
  Object.values(filters).forEach((select) => {
    select.value = "";
  });
  renderAnalysis();
}

function populateFilters(options) {
  Object.entries(filters).forEach(([key, select]) => {
    const currentValue = state.filters[key] || "";
    select.innerHTML = "";
    select.appendChild(new Option("All", ""));
    (options[key] || []).forEach((optionValue) => select.appendChild(new Option(optionValue, optionValue)));
    select.value = (options[key] || []).includes(currentValue) ? currentValue : "";
    state.filters[key] = select.value;
  });
  document.getElementById("clearFilters").disabled = !hasActiveFilters();
}

function hasActiveFilters() {
  return Object.values(state.filters).some(Boolean);
}

function renderAnalysis() {
  if (!state.rows.length) return;
  const analysis = analyzeRows(state.rows, state.mapping, state.filters);
  state.analysis = analysis;
  populateFilters(analysis.filterOptions);
  if (els.emptyState) els.emptyState.hidden = true;
  els.dashboardContent.hidden = false;
  hideDetails(false);

  els.totalChanges.textContent = formatNumber(analysis.total);
  els.completedChanges.textContent = `${formatNumber(analysis.completed)} (${formatPercent(analysis.completed / safeDenominator(analysis.total))})`;
  els.onTimeRate.textContent = `${formatNumber(analysis.onTimeCompleted)} (${formatPercent(analysis.onTimeCompleted / safeDenominator(analysis.completedWithPlan))})`;
  els.overdueChanges.textContent = `${formatNumber(analysis.outsideTimeline)} (${formatPercent(analysis.outsideTimeline / safeDenominator(analysis.total))})`;
  els.lateSubmissionTotal.textContent = `${formatNumber(analysis.lateSubmissionTotal)} (${formatPercent(analysis.lateSubmissionTotal / safeDenominator(analysis.cabTrackedTotal))})`;
  setDrilldown(els.totalChanges, { type: "all" });
  setDrilldown(els.completedChanges, { type: "completed" });
  setDrilldown(els.onTimeRate, { type: "onTime" });
  setDrilldown(els.overdueChanges, { type: "outsideTimeline" });
  setDrilldown(els.lateSubmissionTotal, { type: "lateSubmission" });
  els.timelineRange.textContent = analysis.timeline.length ? `${analysis.timeline[0].label} to ${analysis.timeline[analysis.timeline.length - 1].label}` : "";
  els.reportSummary.textContent = `${formatNumber(analysis.teamRows.length)} teams`;
  els.filteredRowCount.textContent = hasActiveFilters()
    ? `${formatNumber(analysis.total)} of ${formatNumber(analysis.unfilteredTotal)} rows`
    : "All rows";

  renderTimelineChart(els.timelineChart, analysis.timeline);
  renderHorizontalBars(els.teamVolumeChart, analysis.teamRows.slice(0, 10), "total", "#2f6fed", true, "teamTotal");
  renderNotCompletedTeamChart(els.notCompletedTeamChart, analysis.notCompletedTeamRows);
  renderLateSubmissionChart(els.lateSubmissionChart, analysis.lateSubmissionTeamRows);
  renderOnTimeChart(els.onTimeChart, analysis.teamRows);
  renderStatusChart(els.statusChart, analysis.statusRows);
  renderChangeTypeChart(els.changeTypeChart, analysis.changeTypeRows);
  renderRiskLevelChart(els.riskLevelChart, analysis.riskLevelRows, analysis.total);
  renderTeamReport(analysis.teamRows);
  renderDelayedChanges(analysis.delayedRows);
  renderFindings(analysis);
}

function analyzeRows(rows, mapping, activeFilters = {}) {
  let enriched = rows.map((row, index) => {
    const status = value(row, mapping.status);
    const changeType = value(row, mapping.changeType) || "Unspecified";
    const riskLevel = normalizeRiskLevel(value(row, mapping.riskLevel));
    const plannedStartValue = value(row, mapping.plannedStart);
    const plannedEndValue = value(row, mapping.plannedEnd);
    const actualStartValue = value(row, mapping.actualStart);
    const completedDateValue = value(row, mapping.completedDate);
    const plannedStart = parseDate(plannedStartValue);
    const plannedEnd = parseDate(plannedEndValue);
    const actualStart = parseDate(actualStartValue);
    const completedDate = parseDate(completedDateValue);
    const submittedDate = parseDateTime(value(row, mapping.submittedDate));
    const cabReferenceDate = parseDateTime(plannedStartValue) || parseDateTime(actualStartValue) || parseDateTime(plannedEndValue) || plannedStart || actualStart || plannedEnd;
    const cabCallDate = findCabCallForChange(cabReferenceDate);
    const cabCutoffDate = cabCallDate ? new Date(cabCallDate.getTime() - 72 * 60 * 60 * 1000) : null;
    const isCabSubmissionTracked = isCabSubmissionTrackedChangeType(changeType);
    const lateSubmission = Boolean(isCabSubmissionTracked && submittedDate && cabCutoffDate && submittedDate > cabCutoffDate);
    const team = value(row, mapping.team) || "Unassigned";
    const isCancelled = hasAnyWord(status, cancelledWords);
    const hasCompletedStatus = hasAnyWord(status, completeWords);
    const isCompletedStatus = hasCompletedStatus || (!status && Boolean(completedDate));
    const isCompleted = !isCancelled && (hasCompletedStatus || Boolean(completedDate));
    const hasPlan = Boolean(plannedEnd);
    const onTime = isCompleted && hasPlan && completedDate && completedDate <= plannedEnd;
    const late = isCompleted && hasPlan && completedDate && completedDate > plannedEnd;
    const startedLate = Boolean(plannedStart && actualStart && actualStart > plannedStart);
    const openPastPlan = !isCompleted && !isCancelled && hasPlan && plannedEnd < today;
    const outsideTimeline = Boolean(startedLate || late || openPastPlan);
    const delayDays = hasPlan && completedDate ? dayDiff(plannedEnd, completedDate) : null;
    return {
      index,
      row,
      team,
      status: status || (isCompleted ? "Completed" : "Open"),
      changeType,
      riskLevel,
      plannedStart,
      plannedEnd,
      actualStart,
      completedDate,
      submittedDate,
      cabCallDate,
      cabCutoffDate,
      isCabSubmissionTracked,
      lateSubmission,
      isCompleted,
      isCompletedStatus,
      isCancelled,
      onTime,
      late,
      startedLate,
      openPastPlan,
      outsideTimeline,
      delayDays,
      changeLabel: changeLabel(row, mapping, index),
    };
  });
  const filterOptions = buildFilterOptions(enriched);
  const unfilteredTotal = enriched.length;
  enriched = enriched.filter((item) => matchesDashboardFilters(item, activeFilters));

  const total = enriched.length;
  const completed = enriched.filter((item) => item.isCompleted).length;
  const completedWithPlan = enriched.filter((item) => item.isCompleted && item.plannedEnd && item.completedDate).length;
  const onTimeCompleted = enriched.filter((item) => item.onTime).length;
  const openPastPlan = enriched.filter((item) => item.openPastPlan).length;
  const outsideTimeline = enriched.filter((item) => item.outsideTimeline).length;
  const cabTrackedTotal = enriched.filter((item) => item.isCabSubmissionTracked).length;
  const lateSubmissionTotal = enriched.filter((item) => item.lateSubmission).length;

  const teams = groupBy(enriched, (item) => item.team);
  const teamRows = Object.entries(teams)
    .map(([team, items]) => {
      const completedItems = items.filter((item) => item.isCompleted);
      const notCompletedItems = items.filter((item) => !item.isCompletedStatus);
      const completedPlanned = completedItems.filter((item) => item.plannedEnd && item.completedDate);
      const lateItems = completedItems.filter((item) => item.late);
      const delays = completedItems
        .map((item) => item.delayDays)
        .filter((delay) => Number.isFinite(delay));
      return {
        team,
        total: items.length,
        completed: completedItems.length,
        notCompleted: notCompletedItems.length,
        completedWithPlan: completedPlanned.length,
        completionRate: completedItems.length / safeDenominator(items.length),
        onTime: completedItems.filter((item) => item.onTime).length,
        onTimeRate: completedItems.filter((item) => item.onTime).length / safeDenominator(completedPlanned.length),
        late: lateItems.length,
        lateSubmission: items.filter((item) => item.lateSubmission).length,
        startedLate: items.filter((item) => item.startedLate).length,
        openPastPlan: items.filter((item) => item.openPastPlan).length,
        outsideTimeline: items.filter((item) => item.outsideTimeline).length,
        avgDelay: delays.length ? delays.reduce((sum, delay) => sum + delay, 0) / delays.length : null,
      };
    })
    .sort((a, b) => b.total - a.total || b.onTimeRate - a.onTimeRate || a.team.localeCompare(b.team));
  const notCompletedTeamRows = [...teamRows]
    .filter((row) => row.notCompleted > 0)
    .sort((a, b) => b.notCompleted - a.notCompleted || b.total - a.total || a.team.localeCompare(b.team));
  const lateSubmissionTeamRows = [...teamRows]
    .filter((row) => row.lateSubmission > 0)
    .sort((a, b) => b.lateSubmission - a.lateSubmission || b.total - a.total || a.team.localeCompare(b.team));

  const statusRowsAll = Object.entries(groupBy(enriched, (item) => item.status || "Blank"))
    .map(([status, items]) => ({ status, total: items.length }))
    .sort((a, b) => b.total - a.total);
  const statusRows = statusRowsAll.slice(0, 8);

  const changeTypeRowsAll = Object.entries(groupBy(enriched, (item) => item.changeType || "Unspecified"))
    .map(([changeType, items]) => ({ changeType, total: items.length }))
    .sort((a, b) => b.total - a.total || a.changeType.localeCompare(b.changeType));
  const changeTypeRows = changeTypeRowsAll.slice(0, 10);

  const riskOrder = { High: 1, Medium: 2, Low: 3, Unspecified: 4 };
  const riskLevelRows = Object.entries(groupBy(enriched, (item) => item.riskLevel || "Unspecified"))
    .map(([riskLevel, items]) => ({ riskLevel, total: items.length }))
    .sort((a, b) => (riskOrder[a.riskLevel] || 99) - (riskOrder[b.riskLevel] || 99) || b.total - a.total || a.riskLevel.localeCompare(b.riskLevel));

  const timeline = buildTimeline(enriched);
  const delayedRows = enriched
    .filter((item) => item.outsideTimeline)
    .map((item) => ({
      change: item.changeLabel,
      team: item.team,
      status: item.status,
      plannedEnd: formatDate(item.plannedEnd),
      completedDate: item.completedDate ? formatDate(item.completedDate) : "Open",
      exception: exceptionLabel(item),
      delayDays: exceptionDelay(item),
      isOpen: item.openPastPlan,
    }))
    .sort((a, b) => b.delayDays - a.delayDays)
    .slice(0, 25);

  return {
    enriched,
    filterOptions,
    unfilteredTotal,
    total,
    completed,
    completedWithPlan,
    onTimeCompleted,
    openPastPlan,
    outsideTimeline,
    cabTrackedTotal,
    lateSubmissionTotal,
    teamRows,
    notCompletedTeamRows,
    lateSubmissionTeamRows,
    statusRows,
    statusRowsAll,
    changeTypeRows,
    changeTypeRowsAll,
    riskLevelRows,
    timeline,
    delayedRows,
  };
}

function value(row, column) {
  return column ? String(row[column] || "").trim() : "";
}

function changeLabel(row, mapping, index) {
  const id = value(row, mapping.id);
  const title = value(row, mapping.title);
  if (id && title) return `${id} - ${title}`;
  return id || title || `Row ${index + 1}`;
}

function buildFilterOptions(items) {
  return {
    team: uniqueSorted(items.map((item) => item.team)),
    status: uniqueSorted(items.map((item) => item.status)),
    changeType: uniqueSorted(items.map((item) => item.changeType)),
    riskLevel: uniqueSorted(items.map((item) => item.riskLevel)),
  };
}

function uniqueSorted(values) {
  return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

function matchesDashboardFilters(item, activeFilters) {
  return (
    (!activeFilters.team || item.team === activeFilters.team) &&
    (!activeFilters.status || item.status === activeFilters.status) &&
    (!activeFilters.changeType || item.changeType === activeFilters.changeType) &&
    (!activeFilters.riskLevel || item.riskLevel === activeFilters.riskLevel)
  );
}

function showDrilldown(filter) {
  if (!state.analysis) return;
  const items = filterChanges(filter);
  state.currentDetails = items;
  state.currentDetailsTitle = describeFilter(filter);
  els.detailTitle.textContent = state.currentDetailsTitle;
  els.detailSummary.textContent = `${formatNumber(items.length)} of ${formatNumber(state.analysis.total)} changes`;
  els.detailBody.innerHTML = renderDetailRows(items);
  els.detailPanel.hidden = false;
  els.detailPanel.scrollIntoView({ behavior: "smooth", block: "start" });
}

function hideDetails(clearRows) {
  els.detailPanel.hidden = true;
  if (clearRows) {
    state.currentDetails = [];
    state.currentDetailsTitle = "";
    els.detailBody.innerHTML = "";
  }
}

function filterChanges(filter) {
  return state.analysis.enriched.filter((item) => matchesFilter(item, filter));
}

function matchesFilter(item, filter) {
  switch (filter.type) {
    case "all":
      return true;
    case "completed":
      return item.isCompleted;
    case "onTime":
      return item.onTime;
    case "lateSubmission":
      return item.lateSubmission;
    case "outsideTimeline":
      return item.outsideTimeline;
    case "teamTotal":
      return item.team === filter.team;
    case "teamCompleted":
      return item.team === filter.team && item.isCompleted;
    case "teamNotCompleted":
      return item.team === filter.team && !item.isCompletedStatus;
    case "teamLateSubmission":
      return item.team === filter.team && item.lateSubmission;
    case "teamOnTime":
      return item.team === filter.team && item.onTime;
    case "teamLate":
      return item.team === filter.team && item.late;
    case "teamOpenPastPlan":
      return item.team === filter.team && item.openPastPlan;
    case "teamOutsideTimeline":
      return item.team === filter.team && item.outsideTimeline;
    case "teamDelay":
      return item.team === filter.team && item.isCompleted && item.plannedEnd && item.completedDate;
    case "status":
      return item.status === filter.status;
    case "changeType":
      return item.changeType === filter.changeType;
    case "riskLevel":
      return item.riskLevel === filter.riskLevel;
    case "timelinePlanned":
      return sameMonth(item.plannedEnd, filter.month);
    case "timelineCompleted":
      return item.isCompleted && sameMonth(item.completedDate, filter.month);
    default:
      return false;
  }
}

function describeFilter(filter) {
  switch (filter.type) {
    case "all":
      return "All Changes";
    case "completed":
      return "Completed Changes";
    case "onTime":
      return "Changes Finished On Time";
    case "lateSubmission":
      return "Late CAB Submissions";
    case "outsideTimeline":
      return "Timeline Exceptions";
    case "teamTotal":
      return `${filter.team} Changes`;
    case "teamCompleted":
      return `${filter.team} Completed Changes`;
    case "teamNotCompleted":
      return `${filter.team} Not Completed Status Changes`;
    case "teamLateSubmission":
      return `${filter.team} Late CAB Submissions`;
    case "teamOnTime":
      return `${filter.team} Finished On Time`;
    case "teamLate":
      return `${filter.team} Late Finishes`;
    case "teamOpenPastPlan":
      return `${filter.team} Open Past Plan`;
    case "teamOutsideTimeline":
      return `${filter.team} Timeline Exceptions`;
    case "teamDelay":
      return `${filter.team} Completed Planned Changes`;
    case "status":
      return `Status: ${filter.status}`;
    case "changeType":
      return `Change Type: ${filter.changeType}`;
    case "riskLevel":
      return `Risk Level: ${filter.riskLevel}`;
    case "timelinePlanned":
      return `${monthLabel(filter.month)} Planned Changes`;
    case "timelineCompleted":
      return `${monthLabel(filter.month)} Completed Changes`;
    default:
      return "Changes";
  }
}

function renderDetailRows(items) {
  if (!items.length) {
    return `<tr><td colspan="14">No matching changes found.</td></tr>`;
  }
  return items
    .map((item) => {
      const key = value(item.row, state.mapping.id) || item.changeLabel;
      const summary = value(item.row, state.mapping.title) || item.changeLabel;
      const exception = [
        item.outsideTimeline ? exceptionLabel(item) : "",
        item.lateSubmission ? "Late CAB submission" : "",
      ].filter(Boolean).join("; ");
      return `
        <tr>
          <td>${escapeHtml(key)}</td>
          <td>${escapeHtml(summary)}</td>
          <td>${escapeHtml(item.team)}</td>
          <td><span class="status-pill ${item.openPastPlan ? "bad" : item.outsideTimeline ? "warn" : item.isCompleted ? "ok" : ""}">${escapeHtml(item.status)}</span></td>
          <td>${escapeHtml(item.changeType)}</td>
          <td>${escapeHtml(item.riskLevel)}</td>
          <td>${formatDateTime(item.submittedDate)}</td>
          <td>${formatDateTime(item.cabCallDate)}</td>
          <td>${formatDateTime(item.cabCutoffDate)}</td>
          <td>${formatDate(item.plannedStart)}</td>
          <td>${formatDate(item.plannedEnd)}</td>
          <td>${formatDate(item.actualStart)}</td>
          <td>${formatDate(item.completedDate)}</td>
          <td>${escapeHtml(exception)}</td>
        </tr>`;
    })
    .join("");
}

function exportVisibleDetails() {
  if (!state.currentDetails.length) return;
  const headers = ["Key", "Summary", "Team", "Status", "Change Type", "Risk Level", "Submitted", "CAB Call", "CAB Cutoff", "Planned Start", "Planned End", "Change Start", "Completed", "Exception"];
  const rows = state.currentDetails.map((item) => [
    value(item.row, state.mapping.id) || item.changeLabel,
    value(item.row, state.mapping.title) || item.changeLabel,
    item.team,
    item.status,
    item.changeType,
    item.riskLevel,
    formatDateTime(item.submittedDate),
    formatDateTime(item.cabCallDate),
    formatDateTime(item.cabCutoffDate),
    formatDate(item.plannedStart),
    formatDate(item.plannedEnd),
    formatDate(item.actualStart),
    formatDate(item.completedDate),
    [
      item.outsideTimeline ? exceptionLabel(item) : "",
      item.lateSubmission ? "Late CAB submission" : "",
    ].filter(Boolean).join("; "),
  ]);
  const csv = [headers, ...rows].map((cells) => cells.map(csvCell).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `${slugify(state.currentDetailsTitle || "changes")}.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
}

function sameMonth(date, month) {
  return Boolean(date && monthKey(date) === month);
}

function setDrilldown(element, filter) {
  element.dataset.drilldown = encodeFilter(filter);
}

function drilldownButton(label, filter) {
  return `<button type="button" class="metric-link" data-drilldown="${encodeFilter(filter)}">${escapeHtml(label)}</button>`;
}

function encodeFilter(filter) {
  return encodeURIComponent(JSON.stringify(filter));
}

function decodeFilter(raw) {
  try {
    return JSON.parse(decodeURIComponent(raw));
  } catch {
    return null;
  }
}

function exceptionLabel(item) {
  if (item.openPastPlan) return "Open past planned end";
  if (item.late) return "Completed late";
  if (item.startedLate) return "Started late";
  return "Outside planned window";
}

function exceptionDelay(item) {
  if (item.openPastPlan) return Math.max(0, dayDiff(item.plannedEnd, today));
  if (item.late) return Math.max(0, item.delayDays);
  if (item.startedLate) return Math.max(0, dayDiff(item.plannedStart, item.actualStart));
  return 0;
}

function hasAnyWord(value, words) {
  const text = ` ${normalize(value)} `;
  return words.some((word) => text.includes(` ${normalize(word)} `));
}

function parseDate(raw) {
  const text = String(raw || "").trim();
  if (!text) return null;

  if (/^\d+(\.\d+)?$/.test(text)) {
    const serial = Number(text);
    if (serial > 20000 && serial < 90000) {
      return startOfDay(new Date(1899, 11, 30 + serial));
    }
  }

  const isoMatch = text.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (isoMatch) {
    return startOfDay(new Date(Number(isoMatch[1]), Number(isoMatch[2]) - 1, Number(isoMatch[3])));
  }

  const usMatch = text.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})/);
  if (usMatch) {
    const year = Number(usMatch[3].length === 2 ? `20${usMatch[3]}` : usMatch[3]);
    return startOfDay(new Date(year, Number(usMatch[1]) - 1, Number(usMatch[2])));
  }

  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : startOfDay(parsed);
}

function parseDateTime(raw) {
  const text = String(raw || "").trim();
  if (!text) return null;

  if (/^\d+(\.\d+)?$/.test(text)) {
    const serial = Number(text);
    if (serial > 20000 && serial < 90000) {
      const days = Math.floor(serial);
      const milliseconds = Math.round((serial - days) * 86400000);
      const date = new Date(1899, 11, 30 + days);
      return new Date(date.getTime() + milliseconds);
    }
  }

  const isoMatch = text.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(.*)$/);
  if (isoMatch) {
    return localDateTime(Number(isoMatch[1]), Number(isoMatch[2]) - 1, Number(isoMatch[3]), isoMatch[4]);
  }

  const usMatch = text.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})(.*)$/);
  if (usMatch) {
    const year = Number(usMatch[3].length === 2 ? `20${usMatch[3]}` : usMatch[3]);
    return localDateTime(year, Number(usMatch[1]) - 1, Number(usMatch[2]), usMatch[4]);
  }

  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function localDateTime(year, monthIndex, day, timeText) {
  const time = parseTime(timeText);
  return new Date(year, monthIndex, day, time.hour, time.minute, time.second);
}

function parseTime(raw) {
  const text = String(raw || "").trim();
  const match = text.match(/(\d{1,2})(?::(\d{2}))?(?::(\d{2}))?\s*(AM|PM)?/i);
  if (!match) return { hour: 0, minute: 0, second: 0 };
  let hour = Number(match[1]);
  const minute = Number(match[2] || 0);
  const second = Number(match[3] || 0);
  const meridiem = String(match[4] || "").toUpperCase();
  if (meridiem === "PM" && hour < 12) hour += 12;
  if (meridiem === "AM" && hour === 12) hour = 0;
  return { hour, minute, second };
}

function findCabCallForChange(referenceDate) {
  if (!referenceDate) return null;
  const candidate = new Date(referenceDate.getFullYear(), referenceDate.getMonth(), referenceDate.getDate(), 8, 0, 0, 0);
  for (let offset = 0; offset < 14; offset += 1) {
    const cabCall = new Date(candidate);
    cabCall.setDate(candidate.getDate() - offset);
    if (cabCall.getDay() === 2 || cabCall.getDay() === 5) return cabCall;
  }
  return null;
}

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function dayDiff(start, end) {
  if (!start || !end) return 0;
  return Math.round((startOfDay(end) - startOfDay(start)) / 86400000);
}

function groupBy(items, getter) {
  return items.reduce((groups, item) => {
    const key = getter(item) || "Blank";
    groups[key] ||= [];
    groups[key].push(item);
    return groups;
  }, {});
}

function buildTimeline(items) {
  const planned = new Map();
  const completed = new Map();

  items.forEach((item) => {
    if (item.plannedEnd) increment(planned, monthKey(item.plannedEnd));
    if (item.isCompleted && item.completedDate) increment(completed, monthKey(item.completedDate));
  });

  const keys = [...new Set([...planned.keys(), ...completed.keys()])].sort();
  return keys.map((key) => ({
    key,
    label: monthLabel(key),
    planned: planned.get(key) || 0,
    completed: completed.get(key) || 0,
  }));
}

function increment(map, key) {
  map.set(key, (map.get(key) || 0) + 1);
}

function monthKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(key) {
  const [year, month] = key.split("-").map(Number);
  return new Date(year, month - 1, 1).toLocaleDateString(undefined, { month: "short", year: "2-digit" });
}

function renderTimelineChart(container, data) {
  if (!data.length) return renderEmpty(container, "No planned or completed dates found.");
  const width = 860;
  const height = 280;
  const margin = { top: 16, right: 22, bottom: 54, left: 42 };
  const chartWidth = width - margin.left - margin.right;
  const chartHeight = height - margin.top - margin.bottom;
  const maxValue = Math.max(1, ...data.map((row) => Math.max(row.planned, row.completed)));
  const groupWidth = chartWidth / data.length;
  const barWidth = Math.max(8, Math.min(26, groupWidth / 3));

  const bars = data
    .map((row, index) => {
      const x = margin.left + index * groupWidth + groupWidth / 2;
      const plannedHeight = (row.planned / maxValue) * chartHeight;
      const completedHeight = (row.completed / maxValue) * chartHeight;
      const label = data.length <= 14 || index % Math.ceil(data.length / 12) === 0 ? svgText(x, height - 20, row.label, "middle", "axis") : "";
      const plannedFilter = encodeFilter({ type: "timelinePlanned", month: row.key });
      const completedFilter = encodeFilter({ type: "timelineCompleted", month: row.key });
      return `
        <rect class="chart-click-target" tabindex="0" data-drilldown="${plannedFilter}" x="${x - barWidth - 2}" y="${margin.top + chartHeight - plannedHeight}" width="${barWidth}" height="${plannedHeight}" rx="3" fill="#2f6fed">
          <title>${row.label}: ${row.planned} planned</title>
        </rect>
        <rect class="chart-click-target" tabindex="0" data-drilldown="${completedFilter}" x="${x + 2}" y="${margin.top + chartHeight - completedHeight}" width="${barWidth}" height="${completedHeight}" rx="3" fill="#16875f">
          <title>${row.label}: ${row.completed} completed</title>
        </rect>
        ${label}`;
    })
    .join("");

  container.innerHTML = `
    <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Planned versus completed changes over time">
      ${gridLines(width, height, margin, maxValue)}
      ${bars}
      ${legend(width - 210, 12, [["#2f6fed", "Planned"], ["#16875f", "Completed"]])}
    </svg>`;
}

function renderHorizontalBars(container, rows, valueKey, color, showValues, filterType) {
  if (!rows.length) return renderEmpty(container, "No team data found.");
  const width = 520;
  const rowHeight = 32;
  const margin = { top: 10, right: 54, bottom: 12, left: 150 };
  const height = margin.top + margin.bottom + rows.length * rowHeight;
  const maxValue = Math.max(1, ...rows.map((row) => row[valueKey]));

  const bars = rows
    .map((row, index) => {
      const y = margin.top + index * rowHeight;
      const barWidth = ((width - margin.left - margin.right) * row[valueKey]) / maxValue;
      const filter = encodeFilter({ type: filterType, team: row.team });
      return `
        ${svgText(margin.left - 8, y + 20, truncate(row.team, 22), "end", "axis")}
        <rect class="chart-click-target" tabindex="0" data-drilldown="${filter}" x="${margin.left}" y="${y + 6}" width="${barWidth}" height="18" rx="4" fill="${color}">
          <title>${row.team}: ${row[valueKey]}</title>
        </rect>
        ${showValues ? svgMetricText(margin.left + barWidth + 8, y + 20, formatNumber(row[valueKey]), "start", filter) : ""}`;
    })
    .join("");

  container.innerHTML = `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Team volume">${bars}</svg>`;
}

function renderNotCompletedTeamChart(container, rows) {
  if (!rows.length) return renderEmpty(container, "No not-completed changes found.");
  renderHorizontalBars(container, rows.slice(0, 10), "notCompleted", "#b7791f", true, "teamNotCompleted");
}

function renderLateSubmissionChart(container, rows) {
  if (!container) return;
  if (!state.mapping.submittedDate) return renderEmpty(container, "Select a Submitted date field to calculate CAB submission timing.");
  if (!state.mapping.plannedStart && !state.mapping.actualStart && !state.mapping.plannedEnd) {
    return renderEmpty(container, "Select Planned start, Change start, or Planned end to identify CAB calls.");
  }
  if (!rows.length) return renderEmpty(container, "No late CAB submissions found for Normal changes.");
  renderHorizontalBars(container, rows.slice(0, 10), "lateSubmission", "#c2413b", true, "teamLateSubmission");
}

function renderOnTimeChart(container, rows) {
  const eligible = rows
    .filter((row) => row.completedWithPlan > 0)
    .sort((a, b) => b.onTimeRate - a.onTimeRate || b.completedWithPlan - a.completedWithPlan)
    .slice(0, 10);
  if (!eligible.length) return renderEmpty(container, "No completed changes with planned end dates found.");

  const width = 520;
  const rowHeight = 34;
  const margin = { top: 10, right: 62, bottom: 12, left: 150 };
  const height = margin.top + margin.bottom + eligible.length * rowHeight;
  const bars = eligible
    .map((row, index) => {
      const y = margin.top + index * rowHeight;
      const barWidth = (width - margin.left - margin.right) * row.onTimeRate;
      const color = row.onTimeRate >= 0.8 ? "#16875f" : row.onTimeRate >= 0.5 ? "#b7791f" : "#c2413b";
      const filter = encodeFilter({ type: "teamOnTime", team: row.team });
      return `
        ${svgText(margin.left - 8, y + 21, truncate(row.team, 22), "end", "axis")}
        <rect x="${margin.left}" y="${y + 7}" width="${width - margin.left - margin.right}" height="18" rx="4" fill="#edf1f6"></rect>
        <rect class="chart-click-target" tabindex="0" data-drilldown="${filter}" x="${margin.left}" y="${y + 7}" width="${barWidth}" height="18" rx="4" fill="${color}">
          <title>${row.team}: ${formatPercent(row.onTimeRate)}</title>
        </rect>
        ${svgMetricText(width - margin.right + 8, y + 21, formatPercent(row.onTimeRate), "start", filter)}`;
    })
    .join("");
  container.innerHTML = `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="On-time finish rate by team">${bars}</svg>`;
}

function renderStatusChart(container, rows) {
  if (!rows.length) return renderEmpty(container, "No status data found.");
  const total = rows.reduce((sum, row) => sum + row.total, 0);
  const palette = ["#2f6fed", "#16875f", "#b7791f", "#6f52b5", "#c2413b", "#0f766e", "#755c48", "#647084"];
  const width = 520;
  const rowHeight = 32;
  const margin = { top: 8, right: 56, bottom: 12, left: 160 };
  const height = margin.top + margin.bottom + rows.length * rowHeight;

  const bars = rows
    .map((row, index) => {
      const y = margin.top + index * rowHeight;
      const fraction = row.total / safeDenominator(total);
      const barWidth = (width - margin.left - margin.right) * fraction;
      const filter = encodeFilter({ type: "status", status: row.status });
      return `
        ${svgText(margin.left - 8, y + 20, truncate(row.status, 24), "end", "axis")}
        <rect class="chart-click-target" tabindex="0" data-drilldown="${filter}" x="${margin.left}" y="${y + 6}" width="${barWidth}" height="18" rx="4" fill="${palette[index % palette.length]}">
          <title>${row.status}: ${row.total}</title>
        </rect>
        ${svgMetricText(margin.left + barWidth + 8, y + 20, formatPercent(fraction), "start", filter)}`;
    })
    .join("");

  container.innerHTML = `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Status distribution">${bars}</svg>`;
}

function renderChangeTypeChart(container, rows) {
  if (!rows.length) return renderEmpty(container, "No change type data found.");
  const total = rows.reduce((sum, row) => sum + row.total, 0);
  const palette = ["#2f6fed", "#c2413b", "#16875f", "#b7791f", "#6f52b5", "#0f766e", "#755c48", "#647084"];
  const width = 520;
  const rowHeight = 34;
  const margin = { top: 8, right: 70, bottom: 12, left: 150 };
  const height = margin.top + margin.bottom + rows.length * rowHeight;

  const bars = rows
    .map((row, index) => {
      const y = margin.top + index * rowHeight;
      const fraction = row.total / safeDenominator(total);
      const barWidth = (width - margin.left - margin.right) * fraction;
      const filter = encodeFilter({ type: "changeType", changeType: row.changeType });
      return `
        ${svgText(margin.left - 8, y + 21, truncate(row.changeType, 22), "end", "axis")}
        <rect class="chart-click-target" tabindex="0" data-drilldown="${filter}" x="${margin.left}" y="${y + 7}" width="${barWidth}" height="18" rx="4" fill="${palette[index % palette.length]}">
          <title>${row.changeType}: ${row.total}</title>
        </rect>
        ${svgMetricText(margin.left + barWidth + 8, y + 21, `${formatNumber(row.total)} (${formatPercent(fraction)})`, "start", filter)}`;
    })
    .join("");

  container.innerHTML = `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Change type distribution">${bars}</svg>`;
}

function renderRiskLevelChart(container, rows, totalChanges) {
  if (!rows.length) return renderEmpty(container, "No risk level data found.");
  const total = safeDenominator(totalChanges);
  const colors = {
    High: "#c2413b",
    Medium: "#b7791f",
    Low: "#16875f",
    Unspecified: "#647084",
  };
  const width = 520;
  const rowHeight = 38;
  const margin = { top: 10, right: 84, bottom: 12, left: 140 };
  const height = margin.top + margin.bottom + rows.length * rowHeight;
  const maxValue = Math.max(1, ...rows.map((row) => row.total));

  const bars = rows
    .map((row, index) => {
      const y = margin.top + index * rowHeight;
      const barWidth = ((width - margin.left - margin.right) * row.total) / maxValue;
      const filter = encodeFilter({ type: "riskLevel", riskLevel: row.riskLevel });
      const color = colors[row.riskLevel] || "#647084";
      return `
        ${svgText(margin.left - 8, y + 23, row.riskLevel, "end", "axis")}
        <rect class="chart-click-target" tabindex="0" data-drilldown="${filter}" x="${margin.left}" y="${y + 8}" width="${barWidth}" height="20" rx="4" fill="${color}">
          <title>${row.riskLevel}: ${row.total}</title>
        </rect>
        ${svgMetricText(margin.left + barWidth + 8, y + 23, `${formatNumber(row.total)} (${formatPercent(row.total / total)})`, "start", filter)}`;
    })
    .join("");

  container.innerHTML = `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Change risk level distribution">${bars}</svg>`;
}

function renderTeamReport(rows) {
  els.teamReportBody.innerHTML = rows
    .map((row) => {
      const team = row.team;
      const openPastPlan = row.openPastPlan
        ? `<span class="status-pill bad">${drilldownButton(formatNumber(row.openPastPlan), { type: "teamOpenPastPlan", team })}</span>`
        : drilldownButton("0", { type: "teamOpenPastPlan", team });
      const outsideTimeline = row.outsideTimeline
        ? `<span class="status-pill warn">${drilldownButton(formatNumber(row.outsideTimeline), { type: "teamOutsideTimeline", team })}</span>`
        : drilldownButton("0", { type: "teamOutsideTimeline", team });
      const averageDelay = row.avgDelay === null
        ? drilldownButton("n/a", { type: "teamDelay", team })
        : drilldownButton(`${row.avgDelay.toFixed(1)} days`, { type: "teamDelay", team });
      return `
        <tr>
          <td>${escapeHtml(row.team)}</td>
          <td>${drilldownButton(formatNumber(row.total), { type: "teamTotal", team })}</td>
          <td>${drilldownButton(formatNumber(row.completed), { type: "teamCompleted", team })}</td>
          <td>${drilldownButton(formatPercent(row.completionRate), { type: "teamCompleted", team })}</td>
          <td><span class="status-pill ok">${drilldownButton(`${formatNumber(row.onTime)} (${formatPercent(row.onTimeRate)})`, { type: "teamOnTime", team })}</span></td>
          <td>${drilldownButton(formatNumber(row.late), { type: "teamLate", team })}</td>
          <td>${row.lateSubmission ? `<span class="status-pill bad">${drilldownButton(formatNumber(row.lateSubmission), { type: "teamLateSubmission", team })}</span>` : drilldownButton("0", { type: "teamLateSubmission", team })}</td>
          <td>${openPastPlan}</td>
          <td>${outsideTimeline}</td>
          <td>${averageDelay}</td>
        </tr>`;
    })
    .join("");
}

function renderDelayedChanges(rows) {
  if (!rows.length) {
    els.delayedBody.innerHTML = `<tr><td colspan="7">No timeline exceptions were found.</td></tr>`;
    return;
  }
  els.delayedBody.innerHTML = rows
    .map((row) => `
      <tr>
        <td>${escapeHtml(truncate(row.change, 80))}</td>
        <td>${escapeHtml(row.team)}</td>
        <td><span class="status-pill ${row.isOpen ? "bad" : "warn"}">${escapeHtml(row.status)}</span></td>
        <td>${row.plannedEnd}</td>
        <td>${row.completedDate}</td>
        <td>${escapeHtml(row.exception)}</td>
        <td>${formatNumber(row.delayDays)} days</td>
      </tr>`)
    .join("");
}

function renderFindings(analysis) {
  const topVolume = analysis.teamRows[0];
  const bestOnTime = analysis.teamRows
    .filter((row) => row.completedWithPlan > 0)
    .sort((a, b) => b.onTimeRate - a.onTimeRate || b.onTime - a.onTime || b.completed - a.completed)[0];
  const lateTeams = analysis.teamRows.filter((row) => row.outsideTimeline).length;

  els.primaryFinding.textContent = topVolume
    ? `${topVolume.team} has the most changes with ${formatNumber(topVolume.total)} of ${formatNumber(analysis.total)} total.`
    : "No team ownership column was found.";
  els.timelineFinding.textContent = bestOnTime
    ? `${bestOnTime.team} has the strongest planned-timeline finish rate at ${formatPercent(bestOnTime.onTimeRate)} across ${formatNumber(bestOnTime.completedWithPlan)} completed planned changes.`
    : "Add planned end and completed date fields to calculate on-time finish rate.";
  els.qualityFinding.textContent =
    analysis.outsideTimeline || lateTeams
      ? `${formatNumber(analysis.outsideTimeline)} changes are outside the planned window, with timeline risk present across ${formatNumber(lateTeams)} teams.`
      : "No changes outside the planned window were found in the current file.";
}

async function exportExecutivePptx() {
  if (!state.analysis) return;
  const originalText = els.exportPdf.querySelector("span:last-child").textContent;
  els.exportPdf.disabled = true;
  els.exportPdf.querySelector("span:last-child").textContent = "Creating...";
  try {
    const response = await fetch("/api/pptx", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildExecutivePayload()),
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.error || "PowerPoint export failed.");
    }
    const blob = await response.blob();
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "change-executive-summary.pptx";
    link.click();
    URL.revokeObjectURL(link.href);
  } catch (error) {
    els.qualityFinding.textContent = error.message;
  } finally {
    els.exportPdf.disabled = false;
    els.exportPdf.querySelector("span:last-child").textContent = originalText;
  }
}

function buildExecutivePayload() {
  const analysis = state.analysis;
  const total = safeDenominator(analysis.total);
  const completedPlan = safeDenominator(analysis.completedWithPlan);
  return {
    fileName: state.fileName,
    sheetName: state.sheetName,
    generatedAt: new Date().toLocaleString(),
    timelineLabel: els.timelineRange.textContent || "Timeline unavailable",
    kpis: {
      total: analysis.total,
      completed: analysis.completed,
      completedRate: analysis.completed / total,
      onTimeCompleted: analysis.onTimeCompleted,
      onTimeRate: analysis.onTimeCompleted / completedPlan,
      outsideTimeline: analysis.outsideTimeline,
      outsideTimelineRate: analysis.outsideTimeline / total,
      openPastPlan: analysis.openPastPlan,
    },
    changeTypes: (analysis.changeTypeRowsAll || analysis.changeTypeRows).map((row) => ({
      label: row.changeType,
      total: row.total,
      rate: row.total / total,
    })),
    statuses: (analysis.statusRowsAll || analysis.statusRows).map((row) => ({
      label: row.status,
      total: row.total,
      rate: row.total / total,
    })),
    riskLevels: analysis.riskLevelRows.map((row) => ({
      label: row.riskLevel,
      total: row.total,
      rate: row.total / total,
    })),
    timeline: analysis.timeline.map((row) => ({
      label: row.label,
      planned: row.planned,
      completed: row.completed,
    })),
    topTeams: analysis.teamRows.map((row) => ({
      label: row.team,
      total: row.total,
      completed: row.completed,
      onTimeRate: row.onTimeRate,
      outsideTimeline: row.outsideTimeline,
    })),
    onTimeTeams: [...analysis.teamRows]
      .filter((row) => row.completedWithPlan > 0)
      .sort((a, b) => b.onTimeRate - a.onTimeRate || b.completedWithPlan - a.completedWithPlan)
      .map((row) => ({
        label: row.team,
        rate: row.onTimeRate,
        onTime: row.onTime,
        eligible: row.completedWithPlan,
      })),
    findings: [els.primaryFinding.textContent, els.timelineFinding.textContent, els.qualityFinding.textContent].filter(Boolean),
  };
}

function renderEmpty(container, message) {
  container.innerHTML = `<div class="chart-empty">${escapeHtml(message)}</div>`;
}

function gridLines(width, height, margin, maxValue) {
  const chartHeight = height - margin.top - margin.bottom;
  const lines = [];
  for (let step = 0; step <= 4; step += 1) {
    const value = Math.round((maxValue * step) / 4);
    const y = margin.top + chartHeight - (chartHeight * step) / 4;
    lines.push(`
      <line x1="${margin.left}" x2="${width - margin.right}" y1="${y}" y2="${y}" stroke="#d8dee8"></line>
      ${svgText(margin.left - 8, y + 4, String(value), "end", "axis")}`);
  }
  return lines.join("");
}

function legend(x, y, items) {
  return items
    .map(([color, label], index) => `
      <rect x="${x + index * 98}" y="${y}" width="12" height="12" rx="3" fill="${color}"></rect>
      ${svgText(x + 18 + index * 98, y + 11, label, "start", "axis")}`)
    .join("");
}

function svgText(x, y, text, anchor, className) {
  return `<text x="${x}" y="${y}" text-anchor="${anchor}" class="${className}" fill="#647084" font-size="11">${escapeHtml(text)}</text>`;
}

function svgMetricText(x, y, text, anchor, encodedFilter) {
  return `<text x="${x}" y="${y}" text-anchor="${anchor}" class="axis chart-click-label" data-drilldown="${encodedFilter}" tabindex="0" fill="#2f6fed" font-size="11" font-weight="700">${escapeHtml(text)}</text>`;
}

function exportTeamReport() {
  if (!state.analysis) return;
  const headers = ["Team", "Total", "Completed", "Completion Rate", "Finished On Time", "On-Time Rate", "Late Finish", "Late CAB Submissions", "Started Late", "Open Past Plan", "Outside Timeline", "Avg Delay Days"];
  const rows = state.analysis.teamRows.map((row) => [
    row.team,
    row.total,
    row.completed,
    formatPercent(row.completionRate),
    row.onTime,
    formatPercent(row.onTimeRate),
    row.late,
    row.lateSubmission,
    row.startedLate,
    row.openPastPlan,
    row.outsideTimeline,
    row.avgDelay === null ? "" : row.avgDelay.toFixed(1),
  ]);
  const csv = [headers, ...rows].map((cells) => cells.map(csvCell).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = "change-team-report.csv";
  link.click();
  URL.revokeObjectURL(link.href);
}

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString();
}

function formatPercent(value) {
  if (!Number.isFinite(value)) return "0%";
  return `${Math.round(value * 100)}%`;
}

function formatDate(date) {
  return date ? date.toLocaleDateString() : "";
}

function formatDateTime(date) {
  if (!date) return "";
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function safeDenominator(value) {
  return value > 0 ? value : 1;
}

function truncate(value, maxLength) {
  const text = String(value || "");
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}...` : text;
}

function slugify(value) {
  const slug = String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return slug || "changes";
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
