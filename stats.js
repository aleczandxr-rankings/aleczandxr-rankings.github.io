const statsState = {
    active: false,
    activeTab: "overview",
    yearFrom: null,
    yearTo: null,
    dropdownsInit: false,
};


function showStatsPage() {
    if (!state.manifestTypes || !state.manifestTypes.length) return;

    statsState.active = true;
    document.getElementById("stats-nav-btn").classList.add("active");
    document.getElementById("ui").classList.add("hidden");
    document.getElementById("stats-page").classList.remove("hidden");

    if (!statsState.dropdownsInit) {
        initYearRangeDropdowns();
        statsState.dropdownsInit = true;
    }
    renderStatsPage();
}

function hideStatsPage() {
    if (!statsState.active) return;
    statsState.active = false;
    document.getElementById("stats-nav-btn").classList.remove("active");
    document.getElementById("stats-page").classList.add("hidden");
    document.getElementById("ui").classList.remove("hidden");
}


function getAllYearsAcrossTypes() {
    const s = new Set();
    for (const t of (state.manifestTypes || [])) {
        for (const y of (t.years || [])) s.add(y);
    }
    return [...s].sort();
}

function initYearRangeDropdowns() {
    const years = getAllYearsAcrossTypes();
    if (!years.length) return;

    const fromSel = document.getElementById("stats-year-from");
    const toSel = document.getElementById("stats-year-to");
    fromSel.innerHTML = "";
    toSel.innerHTML = "";
    for (const y of years) {
        fromSel.appendChild(new Option(y, y));
        toSel.appendChild(new Option(y, y));
    }

    if (!statsState.yearFrom) statsState.yearFrom = years[0];
    if (!statsState.yearTo) statsState.yearTo = years[years.length - 1];
    fromSel.value = statsState.yearFrom;
    toSel.value = statsState.yearTo;

    fromSel.addEventListener("change", () => {
        statsState.yearFrom = fromSel.value;
        if (statsState.yearTo < statsState.yearFrom) {
            statsState.yearTo = statsState.yearFrom;
            toSel.value = statsState.yearTo;
        }
        renderStatsPage();
    });
    toSel.addEventListener("change", () => {
        statsState.yearTo = toSel.value;
        if (statsState.yearFrom > statsState.yearTo) {
            statsState.yearFrom = statsState.yearTo;
            fromSel.value = statsState.yearFrom;
        }
        renderStatsPage();
    });
}

function getFilteredDataForType(typeObj) {
    const data = (typeObj.data || []).filter(d =>
        d.year >= statsState.yearFrom && d.year <= statsState.yearTo
    );
    const years = (typeObj.years || []).filter(y =>
        y >= statsState.yearFrom && y <= statsState.yearTo
    );
    return {data, years};
}


function buildStatsTabs() {
    const container = document.getElementById("stats-tabs");
    container.innerHTML = "";

    function makeTab(label, tabId) {
        const btn = document.createElement("button");
        btn.className = "stats-tab-btn" + (statsState.activeTab === tabId ? " active" : "");
        btn.textContent = label;
        btn.addEventListener("click", () => {
            statsState.activeTab = tabId;
            container.querySelectorAll(".stats-tab-btn").forEach(b => b.classList.remove("active"));
            btn.classList.add("active");
            renderActiveTab();
        });
        container.appendChild(btn);
    }

    makeTab("Overview", "overview");
    for (const t of (state.manifestTypes || [])) makeTab(t.label, t.id);
}

function renderActiveTab() {
    const content = document.getElementById("stats-content");
    content.innerHTML = "";
    if (statsState.activeTab === "overview") {
        renderOverviewTab(content);
    } else {
        const typeObj = (state.manifestTypes || []).find(t => t.id === statsState.activeTab);
        if (typeObj) renderTypeTab(content, typeObj);
    }
}

function renderStatsPage() {
    if (!statsState.yearFrom || !statsState.yearTo) return;
    buildStatsTabs();
    renderActiveTab();
}


function rankNum(rank) {
    return rank === "HM" ? 101 : Number(rank);
}

function buildHistoryMap(data) {
    const map = new Map();
    for (const d of data) {
        if (!map.has(d.name)) map.set(d.name, new Map());
        map.get(d.name).set(d.year, {rank: d.rank, tier: d.tier});
    }
    return map;
}


function buildSeriesMap(data) {
    const map = new Map();
    for (const d of data) {
        if (!d.series) continue;
        if (!map.has(d.series)) map.set(d.series, {chars: new Set(), entries: []});
        const s = map.get(d.series);
        s.chars.add(d.name);
        s.entries.push(d);
    }
    return map;
}

function charDisplayName(fullName) {
    return fullName.replace(/\s*\([^)]+\)\s*$/, "").trim();
}

function stdDev(arr) {
    if (arr.length < 2) return 0;
    const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
    return Math.sqrt(arr.reduce((s, v) => s + (v - mean) ** 2, 0) / arr.length);
}

function spearmanCorr(pairs) {
    const n = pairs.length;
    if (n < 3) return null;
    const rankArr = vals => {
        const sorted = [...vals].sort((a, b) => a - b);
        return vals.map(v => sorted.indexOf(v) + 1);
    };
    const rA = rankArr(pairs.map(p => p.a));
    const rB = rankArr(pairs.map(p => p.b));
    const d2 = rA.reduce((s, ra, i) => s + (ra - rB[i]) ** 2, 0);
    return 1 - (6 * d2) / (n * (n * n - 1));
}

function isConsecutive(yA, yB, typeYears) {
    const i = typeYears.indexOf(yA);
    return i >= 0 && typeYears[i + 1] === yB;
}


function computeBiggestRise(hm, years, typeYears) {
    const out = [];
    for (const [name, hist] of hm) {
        let best = null;
        for (let i = 0; i < years.length - 1; i++) {
            const yA = years[i], yB = years[i + 1];
            if (!isConsecutive(yA, yB, typeYears)) continue;
            const a = hist.get(yA), b = hist.get(yB);
            if (!a || !b || a.rank === "HM" || b.rank === "HM") continue;
            const d = rankNum(a.rank) - rankNum(b.rank);
            if (d > 0 && (!best || d > best.delta))
                best = {name, fromYear: yA, toYear: yB, fromRank: a.rank, toRank: b.rank, delta: d};
        }
        if (best) out.push(best);
    }
    return out.sort((a, b) => b.delta - a.delta);
}

function computeBiggestDrop(hm, years, typeYears) {
    const out = [];
    for (const [name, hist] of hm) {
        let worst = null;
        for (let i = 0; i < years.length - 1; i++) {
            const yA = years[i], yB = years[i + 1];
            if (!isConsecutive(yA, yB, typeYears)) continue;
            const a = hist.get(yA), b = hist.get(yB);
            if (!a || !b || a.rank === "HM" || b.rank === "HM") continue;
            const d = rankNum(b.rank) - rankNum(a.rank);
            if (d > 0 && (!worst || d > worst.delta))
                worst = {name, fromYear: yA, toYear: yB, fromRank: a.rank, toRank: b.rank, delta: d};
        }
        if (worst) out.push(worst);
    }
    return out.sort((a, b) => b.delta - a.delta);
}

function computeHighestFluctuation(hm, years) {
    const out = [];
    for (const [name, hist] of hm) {
        const ranks = years.filter(y => hist.has(y) && hist.get(y).rank !== "HM")
            .map(y => rankNum(hist.get(y).rank));
        if (ranks.length < 2) continue;
        const lo = Math.min(...ranks), hi = Math.max(...ranks);
        out.push({name, swing: hi - lo, minRank: lo, maxRank: hi});
    }
    return out.sort((a, b) => b.swing - a.swing);
}

function computeBestHmToRankEntry(hm, years, typeYears) {
    const out = [];
    for (const [name, hist] of hm) {
        for (let i = 1; i < years.length; i++) {
            const yA = years[i - 1], yB = years[i];
            if (!isConsecutive(yA, yB, typeYears)) continue;
            const a = hist.get(yA), b = hist.get(yB);
            if (!a || !b) continue;
            if (Number(a.tier) === 999 && b.rank !== "HM") {
                out.push({name, hmYear: yA, entryYear: yB, entryRank: rankNum(b.rank)});
                break;
            }
        }
    }
    return out.sort((a, b) => a.entryRank - b.entryRank);
}

function computeWorstRankToHmDrop(hm, years, typeYears) {
    const out = [];
    for (const [name, hist] of hm) {
        for (let i = 1; i < years.length; i++) {
            const yA = years[i - 1], yB = years[i];
            if (!isConsecutive(yA, yB, typeYears)) continue;
            const a = hist.get(yA), b = hist.get(yB);
            if (!a || !b) continue;
            if (a.rank !== "HM" && Number(b.tier) === 999) {
                out.push({name, lastRankedYear: yA, lastRank: rankNum(a.rank), hmYear: yB});
                break;
            }
        }
    }
    return out.sort((a, b) => a.lastRank - b.lastRank);
}

function computeMostConsistent(hm, years) {
    const out = [];
    for (const [name, hist] of hm) {
        const ranks = years.filter(y => hist.has(y) && hist.get(y).rank !== "HM")
            .map(y => rankNum(hist.get(y).rank));
        if (ranks.length < 2) continue;
        const sd = stdDev(ranks);
        const avg = ranks.reduce((a, b) => a + b, 0) / ranks.length;
        out.push({name, stdDev: sd, avgRank: avg, years: ranks.length});
    }
    return out.sort((a, b) => a.stdDev - b.stdDev);
}

function computeMostVolatile(hm, years) {
    const out = [];
    for (const [name, hist] of hm) {
        const ranks = years.filter(y => hist.has(y) && hist.get(y).rank !== "HM")
            .map(y => rankNum(hist.get(y).rank));
        if (ranks.length < 2) continue;
        out.push({name, stdDev: stdDev(ranks)});
    }
    return out.sort((a, b) => b.stdDev - a.stdDev);
}


function computeNewEntriesPerYear(filteredData, years, allTypeData) {
    const firstApp = {};
    for (const d of (allTypeData || filteredData)) {
        if (!(d.name in firstApp) || d.year < firstApp[d.name]) firstApp[d.name] = d.year;
    }
    return years.map(y => ({year: y, count: Object.values(firstApp).filter(fy => fy === y).length}));
}


function computeTierHopper(hm, years) {
    const out = [];
    for (const [name, hist] of hm) {
        const tiers = new Set(years.filter(y => hist.has(y) && Number(hist.get(y).tier) !== 999)
            .map(y => hist.get(y).tier));
        if (tiers.size > 1) out.push({name, distinctTiers: tiers.size});
    }
    return out.sort((a, b) => b.distinctTiers - a.distinctTiers);
}


function computeAverageRank(hm, years) {
    const out = [];
    for (const [name, hist] of hm) {
        const ranks = years.filter(y => hist.has(y) && hist.get(y).rank !== "HM")
            .map(y => rankNum(hist.get(y).rank));
        if (!ranks.length) continue;
        out.push({name, avgRank: ranks.reduce((a, b) => a + b, 0) / ranks.length, years: ranks.length});
    }
    return out.sort((a, b) => a.avgRank - b.avgRank);
}

function computeYearOverYearCorrelation(data, years, typeYears) {
    const out = [];
    for (let i = 0; i < years.length - 1; i++) {
        const yA = years[i], yB = years[i + 1];
        if (!isConsecutive(yA, yB, typeYears)) continue;
        const rA = {}, rB = {};
        for (const d of data) {
            if (d.year === yA && d.rank !== "HM") rA[d.name] = rankNum(d.rank);
            if (d.year === yB && d.rank !== "HM") rB[d.name] = rankNum(d.rank);
        }
        const common = Object.keys(rA).filter(n => rB[n] !== undefined);
        if (common.length < 3) continue;
        const corr = spearmanCorr(common.map(n => ({a: rA[n], b: rB[n]})));
        if (corr !== null) out.push({yearA: yA, yearB: yB, corr, n: common.length});
    }
    return out;
}


function computeSeriesMostChars(seriesMap) {
    const out = [];
    for (const [series, {chars}] of seriesMap) {
        if (chars.size > 0) out.push({name: series, count: chars.size});
    }
    return out.sort((a, b) => b.count - a.count);
}

function computeSeriesDominance(seriesMap, years) {
    const out = [];
    for (const [series, {entries}] of seriesMap) {
        const chars = new Set(entries.filter(e => years.includes(e.year) && e.rank !== "HM").map(e => e.name));
        if (chars.size > 0) out.push({name: series, count: chars.size});
    }
    return out.sort((a, b) => b.count - a.count);
}

function computeMediaTypeBreakdown(data, years) {
    const yearSet = new Set(years);
    const byType = new Map();
    for (const d of data) {
        if (!yearSet.has(d.year)) continue;
        const key = getEntrySeriesKey(d);
        const types = MEDIA_TYPE_MAP[key];
        const eff = (types && types.length) ? types : [MEDIA_TYPE_NA];
        for (const t of eff) {
            if (!byType.has(t)) byType.set(t, new Set());
            byType.get(t).add(d.name);
        }
    }
    const out = [];
    for (const typeId of MEDIA_TYPE_ORDER) {
        const s = byType.get(typeId);
        if (s && s.size > 0) out.push({mediaType: typeId, count: s.size, items: [...s].sort()});
    }
    return out;
}


function computeMediaTypeAvgRank(data, years) {
    const yearSet = new Set(years);
    const byType = new Map();
    for (const d of data) {
        if (!yearSet.has(d.year) || d.rank === "HM") continue;
        const key = getEntrySeriesKey(d);
        const types = MEDIA_TYPE_MAP[key] ?? [];
        for (const t of types) {
            if (!byType.has(t)) byType.set(t, new Map());
            if (!byType.get(t).has(d.name)) byType.get(t).set(d.name, []);
            byType.get(t).get(d.name).push(rankNum(d.rank));
        }
    }
    const out = [];
    for (const [typeId, itemMap] of byType) {
        if (!itemMap.size) continue;
        const itemAvgs = [...itemMap.values()].map(rs => rs.reduce((a, b) => a + b, 0) / rs.length);
        const avg = itemAvgs.reduce((a, b) => a + b, 0) / itemAvgs.length;
        out.push({mediaType: typeId, avgRank: avg, count: itemMap.size});
    }
    return out.sort((a, b) => a.avgRank - b.avgRank);
}


function computeMediaTypeTopItems(data, years) {
    const yearSet = new Set(years);
    const itemData = new Map();
    for (const d of data) {
        if (!yearSet.has(d.year)) continue;
        if (!itemData.has(d.name)) itemData.set(d.name, {ranks: [], key: getEntrySeriesKey(d)});
        if (d.rank !== "HM") itemData.get(d.name).ranks.push(rankNum(d.rank));
    }
    const byType = new Map();
    for (const [name, {ranks, key}] of itemData) {
        if (!ranks.length) continue;
        const types = MEDIA_TYPE_MAP[key] ?? [];
        const avg = ranks.reduce((a, b) => a + b, 0) / ranks.length;
        for (const t of types) {
            if (!byType.has(t)) byType.set(t, []);
            byType.get(t).push({name, avgRank: avg, count: ranks.length});
        }
    }
    const out = [];
    for (const typeId of MEDIA_TYPE_ORDER) {
        const items = byType.get(typeId);
        if (!items || !items.length) continue;
        items.sort((a, b) => a.avgRank - b.avgRank);
        out.push({mediaType: typeId, topItem: items[0]});
    }
    return out;
}


function countByTypeForYear(data, year) {
    const map = new Map();
    for (const d of data) {
        if (d.year !== year) continue;
        const key = getEntrySeriesKey(d);
        const types = MEDIA_TYPE_MAP[key] ?? [];
        for (const t of types) map.set(t, (map.get(t) || 0) + 1);
    }
    return map;
}


function computeMediaTypeTrend(data, years) {
    if (years.length < 2) return [];
    const firstYear = years[0], lastYear = years[years.length - 1];
    const first = countByTypeForYear(data, firstYear);
    const last = countByTypeForYear(data, lastYear);
    const allTypes = new Set([...first.keys(), ...last.keys()]);
    const out = [];
    for (const typeId of MEDIA_TYPE_ORDER) {
        if (!allTypes.has(typeId)) continue;
        const f = first.get(typeId) || 0, l = last.get(typeId) || 0;
        out.push({mediaType: typeId, firstCount: f, lastCount: l, change: l - f, firstYear, lastYear});
    }
    return out.filter(r => r.firstCount > 0 || r.lastCount > 0);
}


function showStatsBarTooltip(event, name, typeObj) {
    const slots = {};
    for (const d of (typeObj.data || [])) {
        if (d.name === name) slots[d.year] = {rank: d.rank, tier: d.tier, sub_entries: d.sub_entries ?? null};
    }
    const presentYears = (typeObj.years || []).filter(y => slots[y]);
    if (!presentYears.length) return;

    let prevNum = null;
    const rows = presentYears.map(yr => {
        const {rank, tier, sub_entries: subEntries} = slots[yr];
        const isHm = rank === "HM";
        const currNum = isHm ? Infinity : rankNum(rank);

        let arrow;
        if (prevNum === null) arrow = `<span class="t-prog-arrow t-prog-neu">·</span>`;
        else if (currNum < prevNum) {
            const d = (prevNum !== Infinity && currNum !== Infinity) ? prevNum - currNum : '';
            arrow = `<span class="t-prog-arrow t-prog-up">↑${d}</span>`;
        } else if (currNum > prevNum) {
            const d = (prevNum !== Infinity && currNum !== Infinity) ? currNum - prevNum : '';
            arrow = `<span class="t-prog-arrow t-prog-down">↓${d}</span>`;
        } else {
            arrow = `<span class="t-prog-arrow t-prog-neu">~</span>`;
        }
        prevNum = currNum;

        if (subEntries && subEntries.length > 1) {
            const subRows = subEntries.map(se => {
                const ti = (typeObj.tiers || []).find(t => t.tier === se.tier);
                const tc = ti ? ti.color : "#888";
                const seHm = se.rank === "HM";
                const chip = seHm ? "" : `<span class="t-tier-icon" style="background:${hexToRGBA(tc, 0.28)};color:${visibleColor(tc)}">${se.tier}</span>`;
                return `<span class="t-sub-entry"><span>${seHm ? "HM" : `#${se.rank}`}</span>${chip}<span class="t-alias">${escapeHtml(se.exact)}</span></span>`;
            }).join("");
            return `<div class="t-prog-row"><span class="t-prog-year">${escapeHtml(String(yr))}</span>${arrow}<span class="t-prog-rank t-prog-rank-multi">${subRows}</span></div>`;
        }

        const tierInfo = (typeObj.tiers || []).find(t => t.tier === tier);
        const tierColor = tierInfo ? tierInfo.color : "#888";
        const rankText = isHm ? "HM" : `#${rank}`;
        const iconHtml = isHm ? "" :
            `<span class="t-tier-icon" style="background:${hexToRGBA(tierColor, 0.28)};color:${visibleColor(tierColor)};">${tier}</span>`;
        return `<div class="t-prog-row"><span class="t-prog-year">${escapeHtml(String(yr))}</span>${arrow}<span class="t-prog-rank"><span>${rankText}</span>${iconHtml}</span></div>`;
    }).join('');

    tooltip.html(`<div class="t-name">${escapeHtml(name)}</div>${rows}`);
    moveTooltip(event.clientX, event.clientY);
    tooltip.classed("visible", true);
}

function showSeriesBarTooltip(event, seriesName, seriesMap, typeObj, excludeHm = false) {
    const entry = seriesMap.get(seriesName);
    if (!entry) return;

    const byChar = new Map();
    for (const e of entry.entries) {
        if (excludeHm && e.rank === "HM") continue;
        if (!byChar.has(e.name)) byChar.set(e.name, []);
        byChar.get(e.name).push(e);
    }

    const charsSorted = [...byChar].sort((a, b) => {
        const bestRank = entries => Math.min(...entries.map(e => e.rank === "HM" ? 999 : Number(e.rank)));
        return bestRank(a[1]) - bestRank(b[1]) || a[0].localeCompare(b[0]);
    });

    let rows = "";
    for (const [charName, charEntries] of charsSorted) {
        const nm = charDisplayName(charName);
        const truncated = nm.length > 22 ? nm.slice(0, 21) + "…" : nm;
        const sorted = [...charEntries].sort((a, b) => a.year.localeCompare(b.year));

        const inline = sorted.map(e => {
            const yr = e.year.slice(-2);
            if (e.rank === "HM") return `<span style="color:var(--ink-faint)">${yr}:HM</span>`;
            const tierInfo = (typeObj.tiers || []).find(t => t.tier === e.tier);
            const tc = tierInfo ? tierInfo.color : "#888";
            return `<span style="color:${visibleColor(tc)}">${yr}:#${e.rank}</span>`;
        }).join('<span style="color:var(--border-soft)"> · </span>');
        rows += `<div style="display:grid;grid-template-columns:110px 1fr;gap:4px 8px;align-items:baseline;padding:2px 0">
            <span style="color:var(--ink-dim);font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${escapeHtml(nm)}">${escapeHtml(truncated)}</span>
            <span style="font-family:var(--mono);font-size:10px;white-space:normal;word-break:break-word">${inline}</span>
        </div>`;
    }

    tooltip.html(`<div class="t-name" style="margin-bottom:6px">${escapeHtml(seriesName)}</div>${rows}`);
    moveTooltip(event.clientX, event.clientY);
    tooltip.classed("tooltip-wide", true).classed("visible", true);
}

function showMediaTypeTooltip(event, typeId, itemNames, typeObj) {
    const label = MEDIA_TYPE_LABELS[typeId] || typeId;
    const color = MEDIA_TYPE_COLORS[typeId] || "#888";

    const ranked = itemNames.map(name => {
        const entries = (typeObj ? typeObj.data : []).filter(d => d.name === name && d.rank !== "HM");
        const best = entries.length ? Math.min(...entries.map(d => rankNum(d.rank))) : 999;
        return {name, best};
    }).sort((a, b) => a.best - b.best || a.name.localeCompare(b.name));

    const top = ranked.slice(0, 10);
    const remaining = ranked.length - top.length;
    const vc = visibleColor(color);

    let rows = top.map(({name, best}) => {
        const rankText = best < 999 ? `#${best}` : "HM";
        const nm = name.length > 30 ? name.slice(0, 29) + "…" : name;
        return `<div style="display:grid;grid-template-columns:32px 1fr;gap:3px 8px;align-items:baseline;padding:1px 0">
            <span style="font-family:var(--mono);font-size:10px;color:${vc};text-align:right">${rankText}</span>
            <span style="font-size:11.5px;color:var(--ink-dim)">${escapeHtml(nm)}</span>
        </div>`;
    }).join('');
    if (remaining > 0) rows += `<div style="color:var(--ink-faint);font-size:10px;margin-top:5px">+${remaining} more</div>`;

    tooltip.html(`<div class="t-name" style="margin-bottom:5px">${escapeHtml(label)}</div>${rows}`);
    moveTooltip(event.clientX, event.clientY);
    tooltip.classed("tooltip-wide", true).classed("visible", true);
}

function showBarTextTooltip(event, primaryText, secondaryText) {
    const primary = String(primaryText ?? "");
    const secondary = String(secondaryText ?? "");
    const secondaryHtml = secondary
        ? `<div style="margin-top:6px;color:var(--ink-dim);font-size:11px;line-height:1.35;white-space:normal;word-break:break-word">${escapeHtml(secondary)}</div>`
        : "";
    tooltip.html(`
        <div style="color:var(--ink);font-size:12px;line-height:1.35;white-space:normal;word-break:break-word">${escapeHtml(primary)}</div>
        ${secondaryHtml}
    `);
    moveTooltip(event.clientX, event.clientY);
    tooltip.classed("tooltip-wide", true).classed("visible", true);
}


function renderStatCard(container, {value, label, sub}) {
    const el = document.createElement("div");
    el.className = "stat-card";
    el.innerHTML = `
        <div class="stat-card-value">${escapeHtml(String(value))}</div>
        <div class="stat-card-label">${escapeHtml(label)}</div>
        ${sub ? `<div class="stat-card-sub">${escapeHtml(String(sub))}</div>` : ''}
    `;
    container.appendChild(el);
}

function makeSection(container) {
    const sec = document.createElement("section");
    sec.className = "stats-section";
    container.appendChild(sec);
    return sec;
}

function addSectionHeader(sec, title, desc) {
    const h = document.createElement("h3");
    h.className = "stats-section-title";
    h.textContent = title;
    sec.appendChild(h);
    if (desc) {
        const p = document.createElement("p");
        p.className = "stats-section-sub";
        p.textContent = desc;
        sec.appendChild(p);
    }
}

function renderHorizBar(sec, items, typeObjFallback) {
    const PAGE_SIZE = 10;

    if (!items.length) {
        const p = document.createElement("p");
        p.className = "stats-empty";
        p.textContent = "No data for this metric in the selected year range.";
        sec.appendChild(p);
        return;
    }

    const totalPages = Math.ceil(items.length / PAGE_SIZE);
    let page = 0;

    const wrapper = document.createElement("div");
    wrapper.className = "stats-bar-wrapper";
    sec.appendChild(wrapper);

    const footerEl = document.createElement("div");
    footerEl.className = "stats-pager-footer";
    sec.appendChild(footerEl);

    function draw() {
        wrapper.innerHTML = "";
        footerEl.innerHTML = "";

        const startIdx = page * PAGE_SIZE;
        const pageItems = items.slice(startIdx, startIdx + PAGE_SIZE);

        const nameColW = 294;
        const valueColW = 225;
        const barH = 26, barGap = 5;
        const padL = 16, padTop = 6, padBot = 6;
        const svgH = padTop + pageItems.length * (barH + barGap) - barGap + padBot;

        const svgEl = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        svgEl.setAttribute("class", "stats-bar-chart");
        svgEl.setAttribute("height", svgH);
        wrapper.appendChild(svgEl);
        const svg = d3.select(svgEl);

        requestAnimationFrame(() => {
            const w = wrapper.getBoundingClientRect().width || 700;
            svgEl.setAttribute("width", w);
            const barW = Math.max(60, w - padL - nameColW - valueColW - 8);
            const maxVal = Math.max(...pageItems.map(d => d.barValue ?? d.value), 1);
            const xSc = d3.scaleLinear().domain([0, maxVal]).range([0, barW]);

            const isLight = document.documentElement.classList.contains("light");
            pageItems.forEach((item, i) => {
                const y = padTop + i * (barH + barGap);
                const color = isLight ? "#6366f1" : visibleColor(seriesColor(item.name));
                const bw = Math.max(2, xSc(item.barValue ?? item.value));
                const typeObj = item.typeObj ?? typeObjFallback;

                const g = svg.append("g").attr("class", "stats-bar-row")
                    .attr("transform", `translate(${padL},${y})`);

                g.append("text").attr("class", "stats-bar-rank-num")
                    .attr("x", 12).attr("y", barH / 2).text(startIdx + i + 1);

                const nm = item.name.length > 37 ? item.name.slice(0, 36) + "…" : item.name;
                const nameText = g.append("text").attr("class", "stats-bar-name")
                    .attr("x", nameColW - 6).attr("y", barH / 2).text(nm);

                const barTrack = g.append("rect").attr("x", nameColW).attr("y", 3)
                    .attr("width", barW).attr("height", barH - 6)
                    .attr("rx", 3).attr("fill", "var(--bg-soft)");

                const barFill = g.append("rect").attr("class", "stats-bar-rect")
                    .attr("x", nameColW).attr("y", 3)
                    .attr("width", bw).attr("height", barH - 6)
                    .attr("rx", 3).attr("fill", color);

                const displayValue = String(item.displayValue ?? item.value);
                const valueText = g.append("text").attr("class", "stats-bar-value")
                    .attr("x", nameColW + barW + 8).attr("y", barH / 2)
                    .text(displayValue);

                if (item.hoverFn || typeObj) {
                    barTrack.style("cursor", "pointer")
                        .on("mouseenter", ev => item.hoverFn ? item.hoverFn(ev) : showStatsBarTooltip(ev, item.name, typeObj))
                        .on("mousemove", ev => moveTooltip(ev.clientX, ev.clientY))
                        .on("mouseleave", hideTooltip);
                    barFill.style("cursor", "pointer")
                        .on("mouseenter", ev => item.hoverFn ? item.hoverFn(ev) : showStatsBarTooltip(ev, item.name, typeObj))
                        .on("mousemove", ev => moveTooltip(ev.clientX, ev.clientY))
                        .on("mouseleave", hideTooltip);
                }

                nameText.style("cursor", "help")
                    .on("mouseenter", ev => showBarTextTooltip(ev, item.name, displayValue))
                    .on("mousemove", ev => moveTooltip(ev.clientX, ev.clientY))
                    .on("mouseleave", hideTooltip);

                valueText.style("cursor", "help")
                    .on("mouseenter", ev => showBarTextTooltip(ev, displayValue, item.name))
                    .on("mousemove", ev => moveTooltip(ev.clientX, ev.clientY))
                    .on("mouseleave", hideTooltip);
            });
        });

        if (totalPages > 1) {
            const prev = document.createElement("button");
            prev.className = "stats-pager-btn";
            prev.innerHTML = "&#8592;";
            prev.disabled = page === 0;
            prev.addEventListener("click", () => {
                page = Math.max(0, page - 1);
                draw();
            });

            const info = document.createElement("span");
            info.className = "stats-pager-info";
            info.textContent = `${page + 1} / ${totalPages}`;

            const next = document.createElement("button");
            next.className = "stats-pager-btn";
            next.innerHTML = "&#8594;";
            next.disabled = page === totalPages - 1;
            next.addEventListener("click", () => {
                page = Math.min(totalPages - 1, page + 1);
                draw();
            });

            footerEl.appendChild(prev);
            footerEl.appendChild(info);
            footerEl.appendChild(next);
        }
    }

    draw();
}

function renderVertBar(container, items) {
    if (!items.length) {
        const p = document.createElement("p");
        p.className = "stats-empty";
        p.textContent = "No data.";
        container.appendChild(p);
        return;
    }

    const wrapper = document.createElement("div");
    wrapper.className = "stats-bar-wrapper";
    container.appendChild(wrapper);

    const mT = 20, mR = 16, mB = 34, mL = 34;
    const innerH = 160;
    const totalH = innerH + mT + mB;

    const svgEl = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svgEl.setAttribute("class", "stats-vbar-chart");
    svgEl.setAttribute("height", totalH);
    wrapper.appendChild(svgEl);
    const svg = d3.select(svgEl);

    requestAnimationFrame(() => {
        const w = wrapper.getBoundingClientRect().width || 700;
        svgEl.setAttribute("width", w);
        const innerW = Math.max(60, w - mL - mR);

        const x = d3.scaleBand().domain(items.map(d => d.year)).range([0, innerW]).padding(0.22);
        const maxY = Math.max(...items.map(d => d.count), 1);
        const y = d3.scaleLinear().domain([0, maxY]).range([innerH, 0]);
        const g = svg.append("g").attr("transform", `translate(${mL},${mT})`);


        g.selectAll(".vgrid").data(y.ticks(4)).enter().append("line")
            .attr("x1", 0).attr("x2", innerW)
            .attr("y1", d => y(d)).attr("y2", d => y(d))
            .attr("stroke", "var(--border-soft)").attr("stroke-dasharray", "2 4");


        g.selectAll(".vy").data(y.ticks(4)).enter().append("text")
            .attr("x", -5).attr("y", d => y(d))
            .attr("text-anchor", "end").attr("dominant-baseline", "middle")
            .attr("fill", "var(--ink-faint)").attr("font-family", "var(--mono)").attr("font-size", 10)
            .text(d => d);


        g.selectAll(".vbar").data(items).enter().append("rect")
            .attr("x", d => x(d.year)).attr("y", d => y(d.count))
            .attr("width", x.bandwidth()).attr("height", d => innerH - y(d.count))
            .attr("rx", 3).attr("fill", "var(--accent)").attr("fill-opacity", 0.72);


        g.selectAll(".vval").data(items).enter().append("text")
            .filter(d => d.count > 0)
            .attr("x", d => x(d.year) + x.bandwidth() / 2)
            .attr("y", d => y(d.count) - 4)
            .attr("text-anchor", "middle")
            .attr("fill", "var(--ink-dim)").attr("font-family", "var(--mono)").attr("font-size", 10)
            .text(d => d.count);


        g.selectAll(".vxl").data(items).enter().append("text")
            .attr("x", d => x(d.year) + x.bandwidth() / 2)
            .attr("y", innerH + 17)
            .attr("text-anchor", "middle")
            .attr("fill", "var(--ink-dim)").attr("font-family", "var(--mono)").attr("font-size", 11)
            .text(d => d.year);
    });
}

function renderCrossTypeTable(sec, rows) {
    if (!rows.length) return;
    const table = document.createElement("table");
    table.className = "stats-cross-table";
    const thead = table.createTHead();
    const hr = thead.insertRow();
    ["Type", "Best Average Rank", "Biggest Rise", "Items per Media Type", "Year-over-Year List Stability"].forEach(h => {
        const th = document.createElement("th");
        th.textContent = h;
        hr.appendChild(th);
    });
    const tbody = table.createTBody();
    for (const row of rows) {
        const tr = tbody.insertRow();
        const addCell = (html, isLabel) => {
            const td = tr.insertCell();
            if (isLabel) {
                const s = document.createElement("span");
                s.className = "ct-type-label";
                s.textContent = html;
                td.appendChild(s);
            } else {
                td.innerHTML = html;
            }
        };
        addCell(row.label, true);
        addCell(row.bestAverageRank ? `${escapeHtml(row.bestAverageRank.name)}<small> avg #${row.bestAverageRank.value}</small>` : "-", false);
        addCell(row.rise ? `${escapeHtml(row.rise.name)}<small> +${row.rise.value}</small>` : "-", false);
        addCell(row.itemsPerMediaType ? `${row.itemsPerMediaType.value}<small> ${row.itemsPerMediaType.detail}</small>` : "-", false);
        addCell(row.yearlyStability ? `${row.yearlyStability.value}%<small> ${row.yearlyStability.detail}</small>` : "-", false);
    }
    sec.appendChild(table);
}

function renderCorrelationTable(sec, corrs) {
    if (!corrs.length) {
        const p = document.createElement("p");
        p.className = "stats-empty";
        p.textContent = "Need at least two consecutive years to compute list stability.";
        sec.appendChild(p);
        return;
    }
    const table = document.createElement("table");
    table.className = "stats-corr-table";
    const thead = table.createTHead();
    const hr = thead.insertRow();
    ["Years", "Stability", "Items compared"].forEach(h => {
        const th = document.createElement("th");
        th.textContent = h;
        hr.appendChild(th);
    });
    const tbody = table.createTBody();
    for (const {yearA, yearB, corr, n} of corrs) {
        const tr = tbody.insertRow();
        const pct = Math.round(corr * 100);
        const hue = Math.max(0, Math.round(corr * 120));
        const color = `hsl(${hue}deg 60% 58%)`;
        tr.insertCell().textContent = `${yearA} → ${yearB}`;
        const cc = tr.insertCell();
        cc.textContent = `${pct}%`;
        cc.style.color = color;
        cc.style.fontWeight = "600";
        tr.insertCell().textContent = n;
    }
    sec.appendChild(table);
}


function renderMediaTypeHorizBar(sec, items) {
    if (!items.length) {
        const p = document.createElement("p");
        p.className = "stats-empty";
        p.textContent = "No data for this metric in the selected year range.";
        sec.appendChild(p);
        return;
    }
    const wrapper = document.createElement("div");
    wrapper.className = "stats-bar-wrapper";
    sec.appendChild(wrapper);

    const nameColW = 180, valueColW = 240;
    const barH = 26, barGap = 5, padL = 16, padTop = 6, padBot = 6;
    const svgH = padTop + items.length * (barH + barGap) - barGap + padBot;
    const svgEl = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svgEl.setAttribute("class", "stats-bar-chart");
    svgEl.setAttribute("height", svgH);
    wrapper.appendChild(svgEl);
    const svg = d3.select(svgEl);

    requestAnimationFrame(() => {
        const w = wrapper.getBoundingClientRect().width || 700;
        svgEl.setAttribute("width", w);
        const barW = Math.max(60, w - padL - nameColW - valueColW - 8);
        const maxVal = Math.max(...items.map(d => d.barValue), 1);
        const xSc = d3.scaleLinear().domain([0, maxVal]).range([0, barW]);

        items.forEach((item, i) => {
            const yPos = padTop + i * (barH + barGap);
            const rawColor = MEDIA_TYPE_COLORS[item.mediaType] || "#888";
            const vc = visibleColor(rawColor);
            const bw = Math.max(2, xSc(item.barValue));
            const label = MEDIA_TYPE_LABELS[item.mediaType] || item.mediaType;

            const g = svg.append("g").attr("class", "stats-bar-row")
                .attr("transform", `translate(${padL},${yPos})`);

            g.append("circle").attr("cx", 9).attr("cy", barH / 2).attr("r", 4.5)
                .attr("fill", rawColor).attr("fill-opacity", 0.85);
            const nameText = g.append("text").attr("class", "stats-bar-name")
                .attr("x", nameColW - 6).attr("y", barH / 2).text(label);
            const barTrack = g.append("rect").attr("x", nameColW).attr("y", 3)
                .attr("width", barW).attr("height", barH - 6)
                .attr("rx", 3).attr("fill", "var(--bg-soft)");
            const barFill = g.append("rect").attr("class", "stats-bar-rect")
                .attr("x", nameColW).attr("y", 3)
                .attr("width", bw).attr("height", barH - 6)
                .attr("rx", 3).attr("fill", rawColor).attr("fill-opacity", 0.6);
            const displayValue = String(item.displayValue ?? "");
            const valueText = g.append("text").attr("class", "stats-bar-value")
                .attr("x", nameColW + barW + 8).attr("y", barH / 2)
                .text(displayValue);

            if (item.hoverFn) {
                barTrack.style("cursor", "pointer")
                    .on("mouseenter", ev => item.hoverFn(ev))
                    .on("mousemove", ev => moveTooltip(ev.clientX, ev.clientY))
                    .on("mouseleave", hideTooltip);
                barFill.style("cursor", "pointer")
                    .on("mouseenter", ev => item.hoverFn(ev))
                    .on("mousemove", ev => moveTooltip(ev.clientX, ev.clientY))
                    .on("mouseleave", hideTooltip);
            }

            nameText.style("cursor", "help")
                .on("mouseenter", ev => showBarTextTooltip(ev, label, displayValue))
                .on("mousemove", ev => moveTooltip(ev.clientX, ev.clientY))
                .on("mouseleave", hideTooltip);

            valueText.style("cursor", "help")
                .on("mouseenter", ev => showBarTextTooltip(ev, displayValue, label))
                .on("mousemove", ev => moveTooltip(ev.clientX, ev.clientY))
                .on("mouseleave", hideTooltip);
        });
    });
}


function renderMediaTypeTopItemsList(sec, items, typeObj) {
    if (!items.length) {
        const p = document.createElement("p");
        p.className = "stats-empty";
        p.textContent = "Not enough ranked data to determine top items.";
        sec.appendChild(p);
        return;
    }
    const list = document.createElement("div");
    list.className = "stats-media-top-list";
    for (const {mediaType, topItem} of items) {
        const rawColor = MEDIA_TYPE_COLORS[mediaType] || "#888";
        const vc = visibleColor(rawColor);
        const typeLabel = MEDIA_TYPE_LABELS[mediaType] || mediaType;
        const nm = topItem.name.length > 32 ? topItem.name.slice(0, 31) + "…" : topItem.name;
        const el = document.createElement("div");
        el.className = "stats-media-top-item";
        el.style.cursor = "pointer";
        el.innerHTML = `
            <span class="stats-media-top-type" style="color:${vc}">
                <span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:${rawColor};margin-right:5px;vertical-align:middle;flex-shrink:0"></span>${escapeHtml(typeLabel)}
            </span>
            <span class="stats-media-top-name" title="${escapeHtml(topItem.name)}">${escapeHtml(nm)}</span>
            <span class="stats-media-top-rank">avg #${topItem.avgRank.toFixed(1)}</span>
        `;
        if (typeObj) {
            el.addEventListener("mouseenter", ev => showStatsBarTooltip(ev, topItem.name, typeObj));
            el.addEventListener("mousemove", ev => moveTooltip(ev.clientX, ev.clientY));
            el.addEventListener("mouseleave", hideTooltip);
        }
        list.appendChild(el);
    }
    sec.appendChild(list);
}


function renderMediaBreakdownTable(sec, rows) {

    if (!rows.length) return;
    const presentTypes = MEDIA_TYPE_ORDER.filter(typeId =>
        rows.some(r => (r.counts.get(typeId) || 0) > 0)
    );
    if (!presentTypes.length) return;

    const table = document.createElement("table");
    table.className = "stats-media-breakdown-table";
    const thead = table.createTHead();
    const hr = thead.insertRow();
    hr.insertCell().textContent = "List";
    for (const typeId of presentTypes) {
        const th = document.createElement("th");
        const color = MEDIA_TYPE_COLORS[typeId] || "#888";
        th.innerHTML = `<span style="color:${visibleColor(color)}">${escapeHtml(MEDIA_TYPE_LABELS[typeId] || typeId)}</span>`;
        hr.appendChild(th);
    }
    const tbody = table.createTBody();
    for (const row of rows) {
        const tr = tbody.insertRow();
        const lc = tr.insertCell();
        lc.innerHTML = `<span class="ct-type-label">${escapeHtml(row.label)}</span>`;
        for (const typeId of presentTypes) {
            const n = row.counts.get(typeId) || 0;
            const td = tr.insertCell();
            if (n > 0) {
                td.textContent = n;
                const color = MEDIA_TYPE_COLORS[typeId] || "#888";
                td.style.color = visibleColor(color);
                td.style.fontWeight = "600";
            } else {
                td.textContent = "-";
                td.style.color = "var(--ink-faint)";
            }
        }
    }
    sec.appendChild(table);
}


function renderTypeTab(container, typeObj) {
    const {data, years} = getFilteredDataForType(typeObj);
    const typeYears = typeObj.years || [];
    const hm = buildHistoryMap(data);

    if (!years.length) {
        const p = document.createElement("p");
        p.className = "stats-empty";
        p.textContent = "No data in the selected year range.";
        container.appendChild(p);
        return;
    }

    const allNames = [...hm.keys()];
    const totalRanked = allNames.filter(n => [...hm.get(n).values()].some(v => v.rank !== "HM")).length;
    const cardsRow = document.createElement("div");
    cardsRow.className = "stats-cards-row";
    container.appendChild(cardsRow);
    renderStatCard(cardsRow, {value: years.length, label: "Years in range"});
    renderStatCard(cardsRow, {value: allNames.length, label: "Unique items"});
    renderStatCard(cardsRow, {value: totalRanked, label: "Ever ranked"});
    renderStatCard(cardsRow, {value: data.filter(d => d.rank !== "HM").length, label: "Total ranked entries"});

    const t = typeObj;


    {
        const sec = makeSection(container);
        addSectionHeader(sec, "Biggest Single-Year Rise",
            "Largest rank number improvement between two consecutive years.");
        renderHorizBar(sec, computeBiggestRise(hm, years, typeYears).map(r => ({
            name: r.name,
            value: r.delta, barValue: r.delta,
            displayValue: `#${r.fromRank} → #${r.toRank} (+${r.delta}) in ${r.toYear}`
        })), t);
    }
    {
        const sec = makeSection(container);
        addSectionHeader(sec, "Biggest Single-Year Drop",
            "Largest rank decline between two consecutive years.");
        renderHorizBar(sec, computeBiggestDrop(hm, years, typeYears).map(r => ({
            name: r.name,
            value: r.delta, barValue: r.delta,
            displayValue: `#${r.fromRank} → #${r.toRank} (−${r.delta}) in ${r.toYear}`
        })), t);
    }
    {
        const sec = makeSection(container);
        addSectionHeader(sec, "Highest Rank Fluctuation",
            "Difference between best and worst rank number achieved across all years.");
        renderHorizBar(sec, computeHighestFluctuation(hm, years).map(r => ({
            name: r.name,
            value: r.swing, barValue: r.swing,
            displayValue: `#${r.minRank}–#${r.maxRank} (swing: ${r.swing})`
        })), t);
    }
    {
        const sec = makeSection(container);
        addSectionHeader(sec, "Best HM → Ranking Entry",
            "Highest rank after rising from honorable mention.");
        renderHorizBar(sec, computeBestHmToRankEntry(hm, years, typeYears).map(r => ({
            name: r.name,
            value: r.entryRank, barValue: 102 - r.entryRank,
            displayValue: `HM (${r.hmYear}) → #${r.entryRank} (${r.entryYear})`
        })), t);
    }
    {
        const sec = makeSection(container);
        addSectionHeader(sec, "Worst Ranking → HM Drop",
            "Items that fell to HM from a ranked position.");
        renderHorizBar(sec, computeWorstRankToHmDrop(hm, years, typeYears).map(r => ({
            name: r.name,
            value: r.lastRank, barValue: 102 - r.lastRank,
            displayValue: `#${r.lastRank} (${r.lastRankedYear}) → HM (${r.hmYear})`
        })), t);
    }


    {
        const sec = makeSection(container);
        addSectionHeader(sec, "Best Average Rank",
            "Mean rank across all years with a numeric ranking.");
        renderHorizBar(sec, computeAverageRank(hm, years).map(r => ({
            name: r.name, value: r.avgRank, barValue: 102 - r.avgRank,
            displayValue: `avg #${r.avgRank.toFixed(1)} over ${r.years}yr`
        })), t);
    }
    {
        const sec = makeSection(container);
        addSectionHeader(sec, "Most Consistent",
            "Lowest standard deviation of rank - barely moved year to year (min. 2 years).");
        renderHorizBar(sec, computeMostConsistent(hm, years).map(r => ({
            name: r.name, value: r.stdDev, barValue: Math.max(0, 50 - r.stdDev),
            displayValue: `σ=${r.stdDev.toFixed(1)}, avg #${r.avgRank.toFixed(1)}`
        })), t);
    }
    {
        const sec = makeSection(container);
        addSectionHeader(sec, "Most Volatile",
            "Highest standard deviation of rank - position changed dramatically (min. 2 years).");
        renderHorizBar(sec, computeMostVolatile(hm, years).map(r => ({
            name: r.name, value: r.stdDev, barValue: r.stdDev,
            displayValue: `σ=${r.stdDev.toFixed(1)}`
        })), t);
    }


    {
        const sec = makeSection(container);
        addSectionHeader(sec, "Tier Hopper",
            "Items that appeared in the most distinct tiers (HM excluded) - widest range of positions.");
        renderHorizBar(sec, computeTierHopper(hm, years).map(r => ({
            name: r.name, value: r.distinctTiers, barValue: r.distinctTiers,
            displayValue: `${r.distinctTiers} distinct tier${r.distinctTiers !== 1 ? "s" : ""}`
        })), t);
    }


    {
        const mHeader = document.createElement("h3");
        mHeader.className = "stats-overview-section-title";
        mHeader.textContent = "Media Type Statistics";
        container.appendChild(mHeader);
    }
    {
        const sec = makeSection(container);
        addSectionHeader(sec, "Items per Media Type",
            "Unique items grouped by their media type. Items with multiple types (e.g. anime + manga) are counted in each. Items with no mapping are shown as N/A.");
        renderMediaTypeHorizBar(sec, computeMediaTypeBreakdown(data, years).map(r => ({
            mediaType: r.mediaType,
            barValue: r.count,
            displayValue: `${r.count} item${r.count !== 1 ? "s" : ""}`,
            hoverFn: ev => showMediaTypeTooltip(ev, r.mediaType, r.items, t),
        })));
    }
    {
        const sec = makeSection(container);
        addSectionHeader(sec, "Average Rank by Media Type",
            "Mean rank across all ranked (non-HM) entries for each media type.");
        renderMediaTypeHorizBar(sec, computeMediaTypeAvgRank(data, years).map(r => ({
            mediaType: r.mediaType,
            barValue: 102 - r.avgRank,
            displayValue: `avg #${r.avgRank.toFixed(1)}  (${r.count} item${r.count !== 1 ? "s" : ""})`,
        })));
    }
    {
        const sec = makeSection(container);
        addSectionHeader(sec, "Best Item per Media Type",
            "The highest-performing item by average rank within each media type. Hover to see full rank history.");
        renderMediaTypeTopItemsList(sec, computeMediaTypeTopItems(data, years), t);
    }
    {
        const trend = computeMediaTypeTrend(data, years);
        if (trend.length > 0 && years.length >= 2) {
            const sec = makeSection(container);
            addSectionHeader(sec, `Media Type Trend (${years[0]} → ${years[years.length - 1]})`,
                "How the number of ranked entries per media type changed from the first to the last year in the selected range.");
            renderMediaTypeHorizBar(sec, trend.map(r => {
                const sign = r.change > 0 ? "+" : "";
                return {
                    mediaType: r.mediaType,
                    barValue: Math.max(r.firstCount, r.lastCount),
                    displayValue: `${r.firstCount} → ${r.lastCount}  (${sign}${r.change})`,
                };
            }));
        }
    }


    {
        const sec = makeSection(container);
        addSectionHeader(sec, "New Entries Per Year",
            "Number of items appearing in the rankings for the first time each year.");
        renderVertBar(sec, computeNewEntriesPerYear(data, years, typeObj.data));
    }

    {
        const sec = makeSection(container);
        addSectionHeader(sec, "Year-over-Year List Stability",
            "Spearman rank correlation between each consecutive year's full rankings. 100% = identical order.");
        renderCorrelationTable(sec, computeYearOverYearCorrelation(data, years, typeYears));
    }


    const hasSeriesData = data.some(d => d.series);
    if (hasSeriesData) {
        const seriesMap = buildSeriesMap(data);
        const seriesYears = years;

        const seriesHeader = document.createElement("h3");
        seriesHeader.className = "stats-overview-section-title";
        seriesHeader.textContent = "Series Statistics";
        container.appendChild(seriesHeader);

        {
            const sec = makeSection(container);
            addSectionHeader(sec, "Most Characters Per Series",
                "Series with the most distinct characters appearing anywhere in the data.");
            renderHorizBar(sec, computeSeriesMostChars(seriesMap).map(r => ({
                name: r.name,
                value: r.count, barValue: r.count,
                displayValue: `${r.count} character${r.count !== 1 ? "s" : ""}`,
                hoverFn: ev => showSeriesBarTooltip(ev, r.name, seriesMap, t),
            })), null);
        }
        {
            const sec = makeSection(container);
            addSectionHeader(sec, "Series Ranked Presence",
                "Unique characters from this series that achieved a numeric rank (HM excluded) across the selected years.");
            renderHorizBar(sec, computeSeriesDominance(seriesMap, seriesYears).map(r => ({
                name: r.name,
                value: r.count, barValue: r.count,
                displayValue: `${r.count} character${r.count !== 1 ? "s" : ""}`,
                hoverFn: ev => showSeriesBarTooltip(ev, r.name, seriesMap, t, true),
            })), null);
        }
    }


}


function renderOverviewTab(container) {
    const types = state.manifestTypes || [];


    const allItems = new Set();
    let totalEntries = 0;
    for (const t of types) {
        const {data} = getFilteredDataForType(t);
        for (const d of data) {
            allItems.add(d.name);
            totalEntries++;
        }
    }
    const cardsRow = document.createElement("div");
    cardsRow.className = "stats-cards-row";
    container.appendChild(cardsRow);
    renderStatCard(cardsRow, {value: types.length, label: "Types"});
    renderStatCard(cardsRow, {value: allItems.size, label: "Unique items"});
    renderStatCard(cardsRow, {value: `${statsState.yearFrom}–${statsState.yearTo}`, label: "Year range"});
    renderStatCard(cardsRow, {value: totalEntries, label: "Total entries"});


    const h1 = document.createElement("h3");
    h1.className = "stats-overview-section-title";
    h1.textContent = "Cross-type comparison";
    container.appendChild(h1);
    const compSec = makeSection(container);
    const tableRows = types.map(typeObj => {
        const {data, years} = getFilteredDataForType(typeObj);
        const typeYears = typeObj.years || [];
        const hm = buildHistoryMap(data);
        const rise = computeBiggestRise(hm, years, typeYears)[0];
        const bestAvg = computeAverageRank(hm, years)[0];
        const mediaBreakdown = computeMediaTypeBreakdown(data, years);
        const topMediaTypes = [...mediaBreakdown]
            .sort((a, b) => b.count - a.count || a.mediaType.localeCompare(b.mediaType))
            .slice(0, 2);
        const yoyCorr = computeYearOverYearCorrelation(data, years, typeYears);
        const avgStability = yoyCorr.length
            ? (yoyCorr.reduce((sum, row) => sum + row.corr, 0) / yoyCorr.length) * 100
            : null;
        return {
            label: typeObj.label,
            rise: rise ? {name: rise.name, value: rise.delta} : null,
            bestAverageRank: bestAvg ? {name: bestAvg.name, value: bestAvg.avgRank.toFixed(1)} : null,
            itemsPerMediaType: topMediaTypes.length
                ? {
                    value: `${MEDIA_TYPE_LABELS[topMediaTypes[0].mediaType] || topMediaTypes[0].mediaType} (${topMediaTypes[0].count})`,
                    detail: topMediaTypes[1]
                        ? `${MEDIA_TYPE_LABELS[topMediaTypes[1].mediaType] || topMediaTypes[1].mediaType} (${topMediaTypes[1].count})`
                        : "Only one media type present",
                }
                : null,
            yearlyStability: avgStability !== null
                ? {
                    value: avgStability.toFixed(1),
                    detail: `(${yoyCorr.length} year pairs)`,
                }
                : null,
        };
    });
    renderCrossTypeTable(compSec, tableRows);


    const h2 = document.createElement("h3");
    h2.className = "stats-overview-section-title";
    h2.textContent = "Biggest single-year movers across all types";
    container.appendChild(h2);

    const risesSec = makeSection(container);
    addSectionHeader(risesSec, "Top Rises", "Biggest rank improvements across all types combined.");
    const allRises = [];
    for (const typeObj of types) {
        const {data, years} = getFilteredDataForType(typeObj);
        const hm = buildHistoryMap(data);
        computeBiggestRise(hm, years, typeObj.years || []).forEach(r =>
            allRises.push({...r, _typeLabel: typeObj.label, _typeObj: typeObj}));
    }
    allRises.sort((a, b) => b.delta - a.delta);
    const topRises = [];
    const seenR = new Set();
    for (const r of allRises) {
        const k = `${r._typeObj.id}::${r.name}`;
        if (!seenR.has(k)) {
            seenR.add(k);
            topRises.push(r);
        }
    }
    renderHorizBar(risesSec, topRises.map(r => ({
        name: r.name,
        value: r.delta, barValue: r.delta,
        displayValue: `${r._typeLabel}: #${r.fromRank}→#${r.toRank} (+${r.delta}) ${r.toYear}`,
        typeObj: r._typeObj,
    })), null);

    const dropsSec = makeSection(container);
    addSectionHeader(dropsSec, "Top Drops", "Biggest rank falls across all types combined.");
    const allDrops = [];
    for (const typeObj of types) {
        const {data, years} = getFilteredDataForType(typeObj);
        const hm = buildHistoryMap(data);
        computeBiggestDrop(hm, years, typeObj.years || []).forEach(r =>
            allDrops.push({...r, _typeLabel: typeObj.label, _typeObj: typeObj}));
    }
    allDrops.sort((a, b) => b.delta - a.delta);
    const topDrops = [];
    const seenD = new Set();
    for (const r of allDrops) {
        const k = `${r._typeObj.id}::${r.name}`;
        if (!seenD.has(k)) {
            seenD.add(k);
            topDrops.push(r);
        }
    }
    renderHorizBar(dropsSec, topDrops.map(r => ({
        name: r.name,
        value: r.delta, barValue: r.delta,
        displayValue: `${r._typeLabel}: #${r.fromRank}→#${r.toRank} (−${r.delta}) ${r.toYear}`,
        typeObj: r._typeObj,
    })), null);


    const charTypes = types.filter(t => t.data && t.data.some(d => d.series));
    if (charTypes.length) {
        const hSeries = document.createElement("h3");
        hSeries.className = "stats-overview-section-title";
        hSeries.textContent = "Series - cross-type comparison";
        container.appendChild(hSeries);


        for (const typeObj of charTypes) {
            const {data, years} = getFilteredDataForType(typeObj);
            const seriesMap = buildSeriesMap(data);
            const domSec = makeSection(container);
            addSectionHeader(domSec, `${typeObj.label} - Most Characters per Series`,
                `Series with the most distinct characters in ${typeObj.label} (ranked + HM).`);
            renderHorizBar(domSec, computeSeriesMostChars(seriesMap).map(r => ({
                name: r.name,
                value: r.count, barValue: r.count,
                displayValue: `${r.count} character${r.count !== 1 ? "s" : ""}`,
                hoverFn: ev => showSeriesBarTooltip(ev, r.name, seriesMap, typeObj),
            })), null);
        }
    }


    {
        const hMedia = document.createElement("h3");
        hMedia.className = "stats-overview-section-title";
        hMedia.textContent = "Media Type Statistics";
        container.appendChild(hMedia);


        const tableRows = types.map(typeObj => {
            const {data, years} = getFilteredDataForType(typeObj);
            const breakdown = computeMediaTypeBreakdown(data, years);
            const counts = new Map(breakdown.map(r => [r.mediaType, r.count]));
            return {label: typeObj.label, counts};
        });
        const tableSec = makeSection(container);
        addSectionHeader(tableSec, "Item Distribution by Media Type",
            "How many unique items in each list belong to each media type.");
        renderMediaBreakdownTable(tableSec, tableRows);


        const allData = [];
        const allYearsFilt = [];
        for (const typeObj of types) {
            const {data, years} = getFilteredDataForType(typeObj);
            allData.push(...data);
            allYearsFilt.push(...years);
        }
        const combinedYears = [...new Set(allYearsFilt)].sort();
        const combinedAvg = computeMediaTypeAvgRank(allData, combinedYears);
        if (combinedAvg.length > 0) {
            const avgSec = makeSection(container);
            addSectionHeader(avgSec, "Average Rank by Media Type (all lists combined)",
                "Mean rank across every ranked entry from all list types, grouped by media type.");
            renderMediaTypeHorizBar(avgSec, combinedAvg.map(r => ({
                mediaType: r.mediaType,
                barValue: 102 - r.avgRank,
                displayValue: `avg #${r.avgRank.toFixed(1)}  (${r.count} item${r.count !== 1 ? "s" : ""})`,
            })));
        }
    }


    const h3 = document.createElement("h3");
    h3.className = "stats-overview-section-title";
    h3.textContent = "New entries per year (all types combined)";
    container.appendChild(h3);
    const newSec = makeSection(container);
    addSectionHeader(newSec, "Debut Count", "Total items making their first appearance in any type each year.");
    const yearCounts = {};
    for (const typeObj of types) {
        const {data, years} = getFilteredDataForType(typeObj);
        computeNewEntriesPerYear(data, years, typeObj.data).forEach(({year, count}) => {
            yearCounts[year] = (yearCounts[year] || 0) + count;
        });
    }
    const allYearsFiltered = getAllYearsAcrossTypes().filter(y => y >= statsState.yearFrom && y <= statsState.yearTo);
    renderVertBar(newSec, allYearsFiltered.map(y => ({year: y, count: yearCounts[y] || 0})));
}


function initStats() {
    const navBtn = document.getElementById("stats-nav-btn");
    if (navBtn) navBtn.addEventListener("click", showStatsPage);

    document.getElementById("type-switcher").addEventListener("click", e => {
        if (e.target.closest(".type-btn") && e.target.id !== "stats-nav-btn") hideStatsPage();
    });

    document.getElementById("theme-toggle").addEventListener("click", () => {
        if (statsState.active) setTimeout(renderStatsPage, 50);
    });
}

document.addEventListener("DOMContentLoaded", initStats);
