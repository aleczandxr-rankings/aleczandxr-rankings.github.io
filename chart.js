function setSlot(itemSlots, d, year, slotIdx) {
    const entry = {slot: slotIdx, rank: d.rank, tier: d.tier, exact: d._seExact ?? d.exact ?? null};
    if (itemSlots[d.name]?.[year]) {
        (itemSlots[d.name][year].extraSlots ??= []).push(entry);
    } else {
        (itemSlots[d.name] ??= {})[year] = {...entry, subEntries: d.sub_entries ?? null, extraSlots: []};
    }
}


function assignSlots(itemSlots, items, year, startSlot) {
    let slotIdx = startSlot;
    for (const d of items) {
        if (d._splitSecondary) {
            const primarySlot = itemSlots[d._splitPrimaryName]?.[year];
            if (primarySlot) {
                (primarySlot.splitPeers ??= []).push(d.name);
                (itemSlots[d.name] ??= {})[year] = {
                    slot: primarySlot.slot, rank: d.rank, tier: d.tier,
                    exact: d._seExact ?? d.exact ?? null,
                    subEntries: null, extraSlots: [], sharedSlot: true,
                };
            }
        } else {
            setSlot(itemSlots, d, year, slotIdx);
            slotIdx++;
        }
    }
}

function computeLayout(tiers, years, data, gapSlots = 2) {
    const HM_TIER = 999;

    const byYearTier = {};
    for (const d of data) {
        (byYearTier[d.year] ??= {});
        if (d.sub_entries && d.sub_entries.length > 1) {

            for (const se of d.sub_entries) {
                (byYearTier[d.year][se.tier] ??= []).push(
                    Object.assign({}, d, {rank: se.rank, tier: se.tier, _seExact: se.exact, _isSub: true})
                );
            }
        } else {
            (byYearTier[d.year][d.tier] ??= []).push(d);
        }
    }
    for (const year of Object.keys(byYearTier)) {
        for (const t of Object.keys(byYearTier[year])) {
            byYearTier[year][t].sort((a, b) => {
                if (a.rank === "HM" && b.rank === "HM") return a.name.localeCompare(b.name);
                if (a.rank === "HM") return 1;
                if (b.rank === "HM") return -1;
                return a.rank - b.rank;
            });
        }
    }


    for (const year of years) {
        for (const tierItems of Object.values(byYearTier[year] ?? {})) {
            const groups = new Map();
            for (const d of tierItems) {
                if (d._isSub || !d.exact) continue;
                const key = `${d.exact}\x00${d.rank}`;
                if (!groups.has(key)) groups.set(key, []);
                groups.get(key).push(d);
            }
            for (const group of groups.values()) {
                if (group.length < 2) continue;
                group[0]._splitPeers = (group[0]._splitPeers ?? []).concat(group.slice(1).map(g => g.name));
                for (let i = 1; i < group.length; i++) {
                    group[i]._splitSecondary = true;
                    group[i]._splitPrimaryName = group[0].name;
                }
            }
        }
    }


    const appearsInRanked = new Set();
    const appearsInHm = new Set();
    for (const d of data) {
        if (Number(d.tier) === HM_TIER) appearsInHm.add(d.name);
        else appearsInRanked.add(d.name);
    }
    const hmGroup2Set = new Set([...appearsInHm].filter(n => !appearsInRanked.has(n)));


    const latestYear = years[years.length - 1];
    const hmGroup2YearCount = {};
    const hmGroup2InLatest = new Set();
    const hmGroup2LastYear = {};
    for (const yr of years) {
        for (const d of byYearTier[yr]?.[HM_TIER] ?? []) {
            if (!hmGroup2Set.has(d.name)) continue;
            hmGroup2YearCount[d.name] = (hmGroup2YearCount[d.name] || 0) + 1;
            if (yr === latestYear) hmGroup2InLatest.add(d.name);
            hmGroup2LastYear[d.name] = yr;
        }
    }
    const hmGroup2Sorted = [...hmGroup2Set].sort((a, b) => {
        const dc = (hmGroup2YearCount[b] || 0) - (hmGroup2YearCount[a] || 0);
        if (dc !== 0) return dc;
        const dl = (hmGroup2InLatest.has(b) ? 1 : 0) - (hmGroup2InLatest.has(a) ? 1 : 0);
        if (dl !== 0) return dl;
        const lyA = hmGroup2LastYear[a] ?? '', lyB = hmGroup2LastYear[b] ?? '';
        if (lyB > lyA) return 1;
        if (lyB < lyA) return -1;
        return a.localeCompare(b);
    });


    const hmSplitAllNames = new Set();
    for (const yr of years) {
        for (const d of byYearTier[yr]?.[HM_TIER] ?? []) {
            if (!hmGroup2Set.has(d.name)) continue;
            if (d._splitPeers?.length > 0 || d._splitSecondary) hmSplitAllNames.add(d.name);
        }
    }

    const hmGroup2StraightSorted = hmGroup2Sorted.filter(n => !hmSplitAllNames.has(n));


    let hmGroup1Cap = 0;
    for (const yr of years) {
        const n = (byYearTier[yr]?.[HM_TIER] ?? []).filter(d => !hmGroup2Set.has(d.name) && !d._splitSecondary).length;
        if (n > hmGroup1Cap) hmGroup1Cap = n;
    }


    let hmSplitCap = 0;
    for (const yr of years) {
        const n = (byYearTier[yr]?.[HM_TIER] ?? []).filter(d => hmSplitAllNames.has(d.name) && !d._splitSecondary).length;
        if (n > hmSplitCap) hmSplitCap = n;
    }

    const tierRanges = {};
    let cursor = 0;
    for (let i = 0; i < tiers.length; i++) {
        const tier = tiers[i];
        const tierNum = tier.tier;
        const isHmTier = Number(tierNum) === HM_TIER;

        let capacity;
        if (isHmTier) {
            capacity = hmGroup1Cap + hmSplitCap + hmGroup2StraightSorted.length;
        } else {
            capacity = 0;
            for (const year of years) {
                const n = (byYearTier[year]?.[tierNum] ?? []).filter(d => !d._splitSecondary).length;
                if (n > capacity) capacity = n;
            }
        }
        if (capacity === 0) continue;

        if (i > 0) cursor += gapSlots;
        const start = cursor;
        const end = cursor + capacity - 1;
        cursor = end + 1;

        tierRanges[tierNum] = {
            start, end, capacity,
            color: tier.color,
            label: tier.label,
            order: i,
            ...(isHmTier ? {hmGroup1Cap, hmSplitCap} : {}),
        };
    }

    const totalSlots = cursor;


    const hmRange = tierRanges[HM_TIER];
    const hmGroup2SlotMap = {};
    if (hmRange) {
        const g1Cap = hmRange.hmGroup1Cap ?? 0;
        const splitCap = hmRange.hmSplitCap ?? 0;
        hmGroup2StraightSorted.forEach((name, idx) => {
            hmGroup2SlotMap[name] = hmRange.start + g1Cap + splitCap + idx;
        });
    }

    const itemSlots = {};
    for (const year of years) {
        for (const tier of Object.keys(byYearTier[year] ?? {})) {
            const tierNum = parseFloat(tier);
            const range = tierRanges[tierNum];
            if (!range) continue;
            const items = byYearTier[year][tier];

            if (tierNum === HM_TIER) {
                const g1Cap = range.hmGroup1Cap ?? 0;

                assignSlots(itemSlots, items.filter(d => !hmGroup2Set.has(d.name)), year, range.start);

                assignSlots(itemSlots,
                    items.filter(d => hmGroup2Set.has(d.name) && hmSplitAllNames.has(d.name)),
                    year, range.start + g1Cap);

                for (const d of items.filter(d => hmGroup2Set.has(d.name) && !hmSplitAllNames.has(d.name))) {
                    const fixedSlot = hmGroup2SlotMap[d.name];
                    if (fixedSlot !== undefined) setSlot(itemSlots, d, year, fixedSlot);
                }
            } else {
                assignSlots(itemSlots, items, year, range.start);
            }
        }
    }

    return {tierRanges, itemSlots, totalSlots};
}


function buildSeriesLineSegments(points) {
    const nonNullIdx = [];
    for (let idx = 0; idx < points.length; idx++) {
        if (points[idx]) nonNullIdx.push(idx);
    }
    const segments = [];
    if (nonNullIdx.length === 0) return segments;

    let a = 0;
    while (a < nonNullIdx.length) {
        let b = a;
        while (b + 1 < nonNullIdx.length && nonNullIdx[b + 1] === nonNullIdx[b] + 1) {
            b++;
        }
        const runPts = [];
        for (let k = a; k <= b; k++) {
            runPts.push(points[nonNullIdx[k]]);
        }
        if (runPts.length >= 2) {
            segments.push({type: "solid", pts: runPts});
        }
        if (b + 1 < nonNullIdx.length) {
            const gap = nonNullIdx[b + 1] - nonNullIdx[b];
            if (gap > 1) {
                segments.push({
                    type: "gap",
                    pts: [points[nonNullIdx[b]], points[nonNullIdx[b + 1]]],
                });
            }
        }
        a = b + 1;
    }
    return segments;
}


const state = {
    tiers: [],
    tierBase: [],
    tierLabelsByYear: {},
    years: [],
    allYears: [],
    data: [],
    allData: [],
    layout: null,
    allItems: [],
    selected: new Set(),
    currentTypeId: null,
    manifestTypes: [],
    exactLookup: {},
    splitPeerGroups: {},
    yearSpacing: 320,
    selectedYear: null,
    yearColumnCaption: {},
    enabledMediaTypes: new Set(MEDIA_TYPE_ORDER),
};

const TYPE_DISPLAY_ORDER = ["fiction", "protagonists", "antagonists", "arcs"];

const tooltip = d3.select("#tooltip");


function seriesColor(name) {
    let h = 0;
    for (let i = 0; i < name.length; i++) {
        h = (h * 31 + name.charCodeAt(i)) >>> 0;
    }
    const hue = h % 360;
    const sat = 62 + (h % 18);
    const isLight = document.documentElement.classList.contains("light");
    const lit = isLight ? (52 + ((h >> 3) % 16)) : (58 + ((h >> 3) % 12));
    return `hsl(${hue}deg ${sat}% ${lit}%)`;
}

function formatTierTitle(tier, label) {
    if (tier === 999 || tier === 999.0) return label;
    if ((label || "").trim().toLowerCase() === "just missed out") return label;
    const num = Number(tier);
    const tierNumText = Number.isInteger(num) ? String(num) : String(num);
    return `Tier ${tierNumText}: ${label}`;
}


function yearAxisTopLabel(yr) {
    const cap = state.yearColumnCaption?.[yr];
    return cap ? `${yr} (${cap})` : yr;
}

function labelsForYear(year) {
    return state.tierLabelsByYear?.[year] || {};
}

function labelForTierAtOrBeforeYear(tierValue, year, fallback) {
    const targetTier = Number(tierValue);
    const candidateYears = state.allYears.filter(y => y <= year).reverse();
    for (const yr of candidateYears) {
        const labels = labelsForYear(yr);
        if (!labels || typeof labels !== "object") continue;
        const direct = labels[String(tierValue)] ?? labels[tierValue];
        if (direct) return direct;
        for (const [k, v] of Object.entries(labels)) {
            if (Number(k) === targetTier) return v;
        }
    }
    return fallback;
}

function rebuildVisibleData() {
    if (!state.selectedYear) return;
    const visibleYears = state.allYears.filter(y => y <= state.selectedYear);
    const visibleYearSet = new Set(visibleYears);
    const visibleData = state.allData.filter(d => visibleYearSet.has(d.year));
    const latestYear = state.allYears[state.allYears.length - 1];
    state.years = visibleYears;
    state.data = visibleData;
    state.tiers = state.tierBase.map(t => ({
        ...t,

        label: labelForTierAtOrBeforeYear(t.tier, latestYear, t.label),
    }));
    state.layout = computeLayout(state.tiers, state.years, state.data);
    state.allItems = [...new Set(visibleData.map(d => d.name))].sort();


    state.splitPeerGroups = {};
    for (const [name, slotsByYear] of Object.entries(state.layout.itemSlots)) {
        for (const slot of Object.values(slotsByYear)) {
            if (!slot.splitPeers?.length) continue;
            for (const peer of slot.splitPeers) {
                (state.splitPeerGroups[name] ??= new Set()).add(peer);
                (state.splitPeerGroups[peer] ??= new Set()).add(name);
            }
        }
    }

    for (const name of Array.from(state.selected)) {
        if (!state.allItems.includes(name)) state.selected.delete(name);
    }
}

function refreshMeta() {
    if (!state.allYears.length) return;
    document.getElementById("meta").innerHTML = `
      <div><strong>${state.allItems.length}</strong> items · <strong>${state.years.length}</strong> years shown (<strong>${state.allYears.length}</strong> total) · <strong>${state.tiers.length}</strong> tiers</div>
      <div>${escapeHtml(state.allYears[0])} &rarr; ${escapeHtml(state.selectedYear)}</div>
    `;
}

function getLatestYearItemsForTier(tierValue) {
    const latestYear = state.years[state.years.length - 1];
    if (!latestYear) return [];
    const tierNum = Number(tierValue);
    const tierItems = state.data
        .filter(d => d.year === latestYear && Number(d.tier) === tierNum)
        .map(d => d.name);
    return [...new Set(tierItems)].sort((a, b) => a.localeCompare(b));
}

function getItemsForTierAndYear(tierValue, yearValue) {
    const tierNum = Number(tierValue);
    const items = state.data
        .filter(d => d.year === yearValue && Number(d.tier) === tierNum)
        .map(d => d.name);
    return [...new Set(items)].sort((a, b) => a.localeCompare(b));
}

function toggleSelectionWithItems(itemNames) {
    if (!itemNames.length) return;
    const itemSet = new Set(itemNames);
    const selectedHasAll = itemNames.every(name => state.selected.has(name));

    if (state.selected.size === 0) {
        state.selected = new Set(itemNames);
    } else if (selectedHasAll) {
        for (const name of itemSet) {
            state.selected.delete(name);
        }
        if (state.selected.size === 0) {
            state.selected = new Set();
        }
    } else {
        for (const name of itemSet) {
            state.selected.add(name);
        }
    }
    refreshPills();
    renderChart();
}

function selectTierLatestYear(tierValue) {
    const latestTierItems = getLatestYearItemsForTier(tierValue);
    toggleSelectionWithItems(latestTierItems);
}

function renderChart() {
    const svg = d3.select("#chart");
    svg.selectAll("*").remove();

    const {tierRanges, itemSlots, totalSlots} = state.layout;
    const years = state.years;

    const SLOT_HEIGHT = 22;
    const MIN_HEIGHT = 480;
    const height = Math.max(MIN_HEIGHT, totalSlots * SLOT_HEIGHT + 120);

    const longestName = state.allItems.reduce((a, b) => b.length > a.length ? b : a, "");
    const approxRightMargin = Math.min(600, Math.max(260, longestName.length * 7 + 40));
    const hasYearCaptions = years.some(yr => state.yearColumnCaption?.[yr]);
    const margin = {
        top: hasYearCaptions ? 78 : 64,
        right: approxRightMargin,
        bottom: 40,
        left: 8,
    };
    const innerW = state.yearSpacing * years.length;
    const width = margin.left + innerW + margin.right;
    const innerH = height - margin.top - margin.bottom;

    svg.attr("viewBox", `0 0 ${width} ${height}`)
        .attr("width", width)
        .attr("height", height);

    const x = d3.scalePoint()
        .domain(years)
        .range([0, innerW])
        .padding(0.08);

    const y = d3.scaleLinear()
        .domain([-0.5, totalSlots - 0.5])
        .range([0, innerH]);

    const g = svg.append("g")
        .attr("transform", `translate(${margin.left},${margin.top})`);
    const latestYear = years[years.length - 1];
    const latestYearX = x(latestYear);
    const firstYearX = x(years[0]);
    const leftTierGutter = Math.max(24, Math.floor(margin.left / 3));
    const tierBandLeftX = firstYearX - leftTierGutter;
    const tierBandRightX = innerW + margin.right - 16;
    const tierBandWidth = tierBandRightX - tierBandLeftX;


    const bandGroup = g.append("g").attr("class", "bands");
    for (const tier of Object.keys(tierRanges)) {
        const r = tierRanges[tier];
        const y0 = y(r.start - 0.5);
        const y1 = y(r.end + 0.5);

        bandGroup.append("rect")
            .attr("class", "tier-band")
            .attr("x", tierBandLeftX)
            .attr("y", y0)
            .attr("width", tierBandWidth)
            .attr("height", y1 - y0)
            .attr("fill", r.color)
            .attr("fill-opacity", 0.065)
            .attr("rx", 4);

        bandGroup.append("line")
            .attr("x1", tierBandLeftX)
            .attr("x2", tierBandRightX)
            .attr("y1", y0).attr("y2", y0)
            .attr("stroke", visibleColor(r.color))
            .attr("stroke-opacity", 0.35)
            .attr("stroke-width", 1);
    }


    const axes = g.append("g").attr("class", "axes");
    for (const yr of years) {
        axes.append("line")
            .attr("class", "year-gridline")
            .attr("x1", x(yr)).attr("x2", x(yr))
            .attr("y1", 0).attr("y2", innerH);

        const firstYr = years[0];
        const topLabel = yearAxisTopLabel(yr);
        const topClass = "year-label year-label-axis-top" + (state.yearColumnCaption?.[yr] ? " year-label-extended" : "");
        const nudgeFirst = yr === firstYr && state.yearColumnCaption?.[firstYr];
        const topX = nudgeFirst ? x(yr) - 10 : x(yr);
        const topAnchor = nudgeFirst ? "start" : "middle";
        axes.append("text")
            .attr("class", topClass)
            .attr("x", topX).attr("y", -34)
            .attr("text-anchor", topAnchor)
            .text(topLabel);

        axes.append("text")
            .attr("class", "year-label")
            .attr("x", x(yr)).attr("y", innerH + 26)
            .attr("text-anchor", "middle")
            .text(yr);
    }


    const seriesGroup = g.append("g").attr("class", "series");
    const dotsGroup = g.append("g").attr("class", "series-dots");
    const tierTitleGroup = g.append("g").attr("class", "tier-titles");
    const labelsGroup = g.append("g").attr("class", "endpoint-labels");
    const labelRows = [];

    const lineSolid = d3.line()
        .x(d => x(d.year))
        .y(d => y(d.slot))
        .curve(d3.curveMonotoneX);

    const activeNames = state.selected.size > 0
        ? Array.from(state.selected)
        : state.allItems;
    const renderSet = new Set(activeNames);
    const hasFilter = state.selected.size > 0;

    for (const name of state.allItems) {
        const slotsByYear = state.layout.itemSlots[name] || {};
        const points = years.map(yr => {
            const s = slotsByYear[yr];
            return s ? {year: yr, slot: s.slot, rank: s.rank, tier: s.tier, name} : null;
        });

        const color = seriesColor(name);
        const active = renderSet.has(name);
        const lineClass = "series-line" + (hasFilter && !active ? " dim" : "");
        const dotClass = "series-dot" + (hasFilter && !active ? " dim" : "");

        const seriesG = seriesGroup.append("g")
            .attr("data-name", name)
            .attr("data-active", active ? "1" : "0");

        const segments = buildSeriesLineSegments(points);
        const hitD = segments.map(seg => lineSolid(seg.pts)).join(" ");
        if (hitD) {
            seriesG.append("path")
                .attr("class", "series-line-hit")
                .attr("d", hitD)
                .attr("fill", "none")
                .attr("stroke", "transparent")
                .attr("stroke-width", 16)
                .style("cursor", "pointer")
                .on("mouseenter", function (event) {
                    highlight(name, true);
                    showSeriesLineTooltip(event, name);
                })
                .on("mousemove", function (event) {
                    moveTooltip(event.clientX, event.clientY);
                })
                .on("mouseleave", function () {
                    highlight(name, false);
                    hideTooltip();
                })
                .on("click", function () {
                    toggleItem(name);
                });
        }
        for (const seg of segments) {
            const segD = lineSolid(seg.pts);
            const visibleClass = lineClass + (seg.type === "gap" ? " series-line-gap" : "");
            seriesG.append("path")
                .attr("class", visibleClass)
                .attr("d", segD)
                .attr("stroke", color)
                .style("pointer-events", "none");
        }


        const valid = points.filter(p => p && !slotsByYear[p.year]?.sharedSlot);


        const dotG = dotsGroup.append("g")
            .attr("data-name", name)
            .attr("data-active", active ? "1" : "0");

        dotG.selectAll("circle")
            .data(valid)
            .enter()
            .append("circle")
            .attr("class", dotClass)
            .attr("cx", d => x(d.year))
            .attr("cy", d => y(d.slot))
            .attr("r", 4.5)
            .attr("fill", color)
            .attr("stroke", "var(--bg-elev)")
            .attr("stroke-width", 1.5)
            .on("mouseenter", function (event, d) {
                const peers = state.splitPeerGroups[name];
                const isSplitYear = slotsByYear[d.year]?.splitPeers?.length > 0;
                if (isSplitYear && peers?.size) {
                    for (const p of peers) highlight(p, true);
                    showSplitTooltip(event, name, d.year);
                } else {
                    highlight(name, true);
                    showTooltip(event, d);
                }
            })
            .on("mousemove", function (event, d) {
                const isSplitYear = slotsByYear[d.year]?.splitPeers?.length > 0;
                if (isSplitYear) moveTooltip(event.clientX, event.clientY);
                else showTooltip(event, d);
            })
            .on("mouseleave", function () {
                const peers = state.splitPeerGroups[name];
                if (peers?.size) for (const p of peers) highlight(p, false);
                highlight(name, false);
                hideTooltip();
            })
            .on("click", function () {
                toggleItem(name);
            });


        for (let i = 0; i < years.length; i++) {
            const yr = years[i];
            const slotA = slotsByYear[yr];
            if (!slotA || !slotA.extraSlots || slotA.extraSlots.length === 0) continue;

            for (const es of slotA.extraSlots) {
                dotG.append("circle")
                    .attr("class", dotClass)
                    .attr("cx", x(yr))
                    .attr("cy", y(es.slot))
                    .attr("r", 4.5)
                    .attr("fill", color)
                    .attr("stroke", "var(--bg-elev)")
                    .attr("stroke-width", 1.5)
                    .on("mouseenter", ev => {
                        highlight(name, true);
                        tooltip.html(blobTooltipInnerHtml(name, yr, es.rank, es.tier, es.exact));
                        moveTooltip(ev.clientX, ev.clientY);
                        tooltip.classed("visible", true);
                    })
                    .on("mousemove", ev => {
                        moveTooltip(ev.clientX, ev.clientY);
                    })
                    .on("mouseleave", () => {
                        highlight(name, false);
                        hideTooltip();
                    })
                    .on("click", () => toggleItem(name));


                const nextYr = years[i + 1];
                const slotB = nextYr ? slotsByYear[nextYr] : null;
                if (slotB) {
                    const convD = lineSolid([
                        {year: yr, slot: es.slot},
                        {year: nextYr, slot: slotB.slot},
                    ]);
                    seriesG.append("path")
                        .attr("class", lineClass)
                        .attr("d", convD)
                        .attr("stroke", color)
                        .style("pointer-events", "none");
                    seriesG.append("path")
                        .attr("class", "series-line-hit")
                        .attr("d", convD)
                        .attr("fill", "none")
                        .attr("stroke", "transparent")
                        .attr("stroke-width", 16)
                        .style("cursor", "pointer")
                        .on("mouseenter", function (ev) {
                            highlight(name, true);
                            showSeriesLineTooltip(ev, name);
                        })
                        .on("mousemove", function (ev) {
                            moveTooltip(ev.clientX, ev.clientY);
                        })
                        .on("mouseleave", function () {
                            highlight(name, false);
                            hideTooltip();
                        })
                        .on("click", function () {
                            toggleItem(name);
                        });
                }
            }
        }

        const lastPoint = [...valid].reverse()[0];
        if (lastPoint) {
            labelRows.push({name, lastPoint, active, hasFilter, color});
        }
    }

    const rankedCountForLabels = getRankedCountPerYear(state.data);
    for (const row of labelRows) {
        const {name, lastPoint, active, hasFilter, color} = row;
        const isLatest = lastPoint.year === latestYear;

        const labelEl = labelsGroup.append("text")
            .attr("class", "endpoint-label" + (hasFilter && !active ? " dim" : ""))
            .attr("data-name", name)
            .attr("data-active", active ? "1" : "0")
            .attr("x", x(lastPoint.year) + 10)
            .attr("y", y(lastPoint.slot))
            .attr("fill", color)
            .style("pointer-events", "all")
            .style("cursor", "pointer");

        if (isLatest) {
            const rankPrefix = lastPoint.rank === "HM" ? "HM" : lastPoint.rank;
            labelEl.append("tspan").text(rankPrefix + ")  " + name);

            const prevYearIdx = years.indexOf(latestYear) - 1;
            if (prevYearIdx >= 0) {
                const prevYear = years[prevYearIdx];
                const prevSlot = state.layout.itemSlots[name]?.[prevYear];
                if (prevSlot) {
                    const currNum = lastPoint.rank === "HM" ? Infinity : lastPoint.rank;
                    const prevNum = prevSlot.rank === "HM" ? Infinity : prevSlot.rank;
                    if (currNum < prevNum) {
                        if (prevNum === Infinity) {
                            const delta = (rankedCountForLabels[latestYear] ?? 100) + 1 - currNum;
                            labelEl.append("tspan").attr("fill", "#4ade80").text("  ↑" + delta + " From Honourable Mentions");
                        } else {
                            labelEl.append("tspan").attr("fill", "#4ade80").text("  ↑" + (prevNum - currNum));
                        }
                    } else if (currNum > prevNum) {
                        if (currNum === Infinity) {
                            const delta = (rankedCountForLabels[latestYear] ?? 100) + 1 - prevNum;
                            labelEl.append("tspan").attr("fill", "#f87171").text("  ↓" + delta + " To Honourable Mentions");
                        } else {
                            labelEl.append("tspan").attr("fill", "#f87171").text("  ↓" + (currNum - prevNum));
                        }
                    } else {
                        labelEl.append("tspan").text("  ~");
                    }
                } else {
                    labelEl.append("tspan").text("  +");
                }
            }
        } else {
            labelEl.text(name);
        }

        labelEl
            .on("mouseenter", function (event) {
                highlight(name, true);
                showSeriesLineTooltip(event, name);
            })
            .on("mousemove", function (event) {
                moveTooltip(event.clientX, event.clientY);
            })
            .on("mouseleave", function () {
                highlight(name, false);
                hideTooltip();
            })
            .on("click", function () {
                toggleItem(name);
            });
    }

    for (const tier of Object.keys(tierRanges)) {
        const r = tierRanges[tier];
        const tierNum = Number(tier);
        const titleY = y(r.start) - 18;

        for (const yr of years) {
            tierTitleGroup.append("circle")
                .attr("class", "tier-year-trigger")
                .attr("data-tier", tier)
                .attr("data-year", yr)
                .attr("cx", x(yr))
                .attr("cy", titleY - 5)
                .attr("r", 8)
                .attr("fill", visibleColor(r.color))
                .style("cursor", "pointer")
                .on("click", function () {
                    const tierYearItems = getItemsForTierAndYear(tier, yr);
                    toggleSelectionWithItems(tierYearItems);
                });
        }

        tierTitleGroup.append("text")
            .attr("class", "tier-title")
            .attr("data-tier", tier)
            .attr("x", latestYearX + 10)
            .attr("y", titleY)
            .attr("fill", visibleColor(r.color))
            .style("cursor", "pointer")
            .text(formatTierTitle(tierNum, r.label))
            .on("click", function () {
                selectTierLatestYear(tier);
            });
    }

    seriesGroup.selectAll("g[data-active='1']").raise();
    dotsGroup.raise();
    dotsGroup.selectAll("g[data-active='1']").raise();
    tierTitleGroup.raise();
    labelsGroup.selectAll("text[data-active='1']").raise();

    applyMediaFilter();
}


function buildSeriesKeyMap() {
    const map = {};
    for (const d of state.allData) {
        if (!(d.name in map)) map[d.name] = getEntrySeriesKey(d);
    }
    return map;
}

function getAvailableMediaTypes() {
    const present = new Set();
    for (const d of state.allData) {
        const key = getEntrySeriesKey(d);
        const types = getMediaTypesForKey(key);
        for (const typeId of types) present.add(typeId);
    }
    return MEDIA_TYPE_ORDER.filter(typeId => present.has(typeId));
}

function applyMediaFilter() {
    const availableTypes = getAvailableMediaTypes();
    const availableTypeSet = new Set(availableTypes);
    const enabledAvailableCount = [...state.enabledMediaTypes].filter(t => availableTypeSet.has(t)).length;
    const allEnabled = enabledAvailableCount === availableTypes.length;
    const seriesKeyMap = buildSeriesKeyMap();
    const svg = d3.select("#chart");

    svg.selectAll("g.series g, g.series-dots g").each(function () {
        const name = this.getAttribute("data-name");
        if (!name) return;
        const key = seriesKeyMap[name] ?? name;
        const types = getMediaTypesForKey(key);
        const visible = allEnabled || types.some(t => state.enabledMediaTypes.has(t));
        d3.select(this).style("display", visible ? null : "none");
    });

    svg.selectAll(".endpoint-label").each(function () {
        const name = this.getAttribute("data-name");
        if (!name) return;
        const key = seriesKeyMap[name] ?? name;
        const types = getMediaTypesForKey(key);
        const visible = allEnabled || types.some(t => state.enabledMediaTypes.has(t));
        d3.select(this).style("display", visible ? null : "none");
    });


    document.querySelectorAll(".media-type-btn").forEach(btn => {
        const typeId = btn.dataset.typeId;
        const active = state.enabledMediaTypes.has(typeId);
        btn.classList.toggle("active", active);
    });

    const countEl = document.getElementById("media-filter-count");
    if (countEl) {
        let total = 0, visible = 0;
        svg.selectAll("g.series g").each(function () {
            if (!this.getAttribute("data-name")) return;
            total++;
            if (d3.select(this).style("display") !== "none") visible++;
        });
        countEl.textContent = allEnabled ? `${total}` : `${visible} / ${total}`;
        countEl.classList.toggle("filtered", !allEnabled);
    }
}

function buildMediaFilterBar() {
    const row = document.getElementById("media-filter-row");
    if (!row) return;
    row.innerHTML = "";

    const availableTypes = getAvailableMediaTypes();
    state.enabledMediaTypes = new Set(
        [...state.enabledMediaTypes].filter(typeId => availableTypes.includes(typeId))
    );
    if (!state.enabledMediaTypes.size) {
        state.enabledMediaTypes = new Set(availableTypes);
    }

    for (const typeId of availableTypes) {
        const btn = document.createElement("button");
        btn.className = "media-type-btn active";
        btn.dataset.typeId = typeId;
        const color = MEDIA_TYPE_COLORS[typeId];
        btn.style.setProperty("--mt-color", color);

        const dot = document.createElement("span");
        dot.className = "media-type-dot";
        btn.appendChild(dot);
        btn.appendChild(document.createTextNode(MEDIA_TYPE_LABELS[typeId]));

        btn.addEventListener("click", () => {
            const allActive =
                state.enabledMediaTypes.size === availableTypes.length;
            if (allActive && state.enabledMediaTypes.has(typeId)) {
                state.enabledMediaTypes = new Set([typeId]);
            } else if (state.enabledMediaTypes.has(typeId)) {
                if (state.enabledMediaTypes.size > 1) {
                    state.enabledMediaTypes.delete(typeId);
                } else {
                    state.enabledMediaTypes = new Set(availableTypes);
                }
            } else {
                state.enabledMediaTypes.add(typeId);
            }
            applyMediaFilter();
        });
        row.appendChild(btn);
    }


    const allBtn = document.createElement("button");
    allBtn.className = "media-type-all-btn";
    allBtn.textContent = "All";
    allBtn.addEventListener("click", () => {
        state.enabledMediaTypes = new Set(availableTypes);
        applyMediaFilter();
    });
    row.appendChild(allBtn);

    const countEl = document.createElement("span");
    countEl.id = "media-filter-count";
    countEl.className = "media-filter-count";
    row.appendChild(countEl);
}

function truncate(s, n) {
    return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

function highlight(name, on) {
    const g = d3.select(`#chart g.series g[data-name="${cssEscape(name)}"]`);
    const dots = d3.select(`#chart g.series-dots g[data-name="${cssEscape(name)}"]`);
    const label = d3.select(`#chart g.endpoint-labels text[data-name="${cssEscape(name)}"]`);
    if (on) {
        g.raise();
        dots.raise();
        label.raise();
        g.selectAll("path.series-line").classed("hover", true).attr("stroke-width", 3.5);
        dots.selectAll("circle.series-dot").transition().duration(120).attr("r", 6);
    } else {
        g.selectAll("path.series-line").classed("hover", false).attr("stroke-width", null);
        dots.selectAll("circle.series-dot").transition().duration(120).attr("r", 4.5);
    }
}

function cssEscape(s) {
    return s.replace(/"/g, '\\"');
}


function blobTooltipInnerHtml(name, year, rank, tier, preferExact = null) {
    const tierInfo = state.tiers.find(t => t.tier === tier);
    const rankText = rank === "HM" ? "Honorable Mention" : `#${rank}`;
    const fallbackLabel = tierInfo ? tierInfo.label : `Tier ${tier}`;
    const tierLabel = labelForTierAtOrBeforeYear(tier, year, fallbackLabel);
    const tierColor = tierInfo ? tierInfo.color : "#888";
    const fromLookup = state.exactLookup[name]?.[year];
    const listed = (preferExact != null && String(preferExact).trim() !== "" && preferExact !== name)
        ? preferExact
        : fromLookup;
    const exactRow = listed && listed !== name
        ? `<div class="t-row"><span>Listed as</span><span class="t-alias">${escapeHtml(listed)}</span></div>`
        : '';

    return `
    <div class="t-name">${escapeHtml(name)}</div>
    <div class="t-row"><span>Year</span><strong>${escapeHtml(String(year))}</strong></div>
    <div class="t-row"><span>Rank</span><strong>${rankText}</strong></div>
    ${exactRow}
    <span class="t-tier" style="background:${hexToRGBA(tierColor, 0.22)};color:${visibleColor(tierColor)};">${tierLabel}</span>
  `;
}

function showTooltip(event, d) {
    tooltip.html(blobTooltipInnerHtml(d.name, d.year, d.rank, d.tier, null));
    moveTooltip(event.clientX, event.clientY);
    tooltip.classed("visible", true);
}

function showSeriesLineTooltip(event, name) {
    const slots = state.layout.itemSlots[name] ?? {};
    const axisYears = state.years;
    const presentYears = axisYears.filter(yr => slots[yr]);
    if (!presentYears.length) return;

    const minY = presentYears[0];
    const maxY = presentYears[presentYears.length - 1];
    const i0 = axisYears.indexOf(minY);
    const i1 = axisYears.indexOf(maxY);
    const spanYears = axisYears.slice(i0, i1 + 1);

    const rankedCount = getRankedCountPerYear(state.data);
    let prevNum = null;
    const progRows = spanYears.map(yr => {
        const slot = slots[yr];
        if (!slot) {
            return `<div class="t-prog-row t-prog-row-missing">
      <span class="t-prog-year t-prog-year-missing">${escapeHtml(yr)}</span>
      <span class="t-prog-arrow t-prog-arrow-missing"></span>
      <span class="t-prog-rank t-prog-rank-missing"></span>
    </div>`;
        }
        const {rank, tier, subEntries} = slot;
        const isHonorableMention = rank === "HM" || Number(rank) === 999;
        const currNum = isHonorableMention ? Infinity : rank;

        let arrowHtml;
        if (prevNum === null) {
            arrowHtml = `<span class="t-prog-arrow t-prog-neu">·</span>`;
        } else if (currNum < prevNum) {
            if (prevNum === Infinity) {
                const d = (rankedCount[yr] ?? 100) + 1 - currNum;
                arrowHtml = `<span class="t-prog-arrow t-prog-up">↑${d} HM</span>`;
            } else {
                arrowHtml = `<span class="t-prog-arrow t-prog-up">↑${prevNum - currNum}</span>`;
            }
        } else if (currNum > prevNum) {
            if (currNum === Infinity) {
                const d = (rankedCount[yr] ?? 100) + 1 - prevNum;
                arrowHtml = `<span class="t-prog-arrow t-prog-down">↓${d} HM</span>`;
            } else {
                arrowHtml = `<span class="t-prog-arrow t-prog-down">↓${currNum - prevNum}</span>`;
            }
        } else {
            arrowHtml = `<span class="t-prog-arrow t-prog-neu">~</span>`;
        }
        prevNum = currNum;

        if (subEntries && subEntries.length > 1) {
            const subRows = subEntries.map(se => {
                const ti = state.tiers.find(t => t.tier === se.tier);
                const tc = ti ? ti.color : "#888";
                const isHm = se.rank === "HM";
                const chip = isHm ? "" : `<span class="t-tier-icon" style="background:${hexToRGBA(tc, 0.28)};color:${visibleColor(tc)}">${se.tier}</span>`;
                return `<span class="t-sub-entry"><span>${isHm ? "HM" : `#${se.rank}`}</span>${chip}<span class="t-alias">${escapeHtml(se.exact)}</span></span>`;
            }).join("");
            return `<div class="t-prog-row">
      <span class="t-prog-year">${escapeHtml(yr)}</span>
      ${arrowHtml}
      <span class="t-prog-rank t-prog-rank-multi">${subRows}</span>
    </div>`;
        }

        const tierInfo = state.tiers.find(t => t.tier === tier);
        const tierColor = tierInfo ? tierInfo.color : "#888";
        const rankText = isHonorableMention ? "HM" : `#${rank}`;
        const tierIconHtml = isHonorableMention
            ? ""
            : `<span class="t-tier-icon" style="background:${hexToRGBA(tierColor, 0.28)};color:${visibleColor(tierColor)};">${tier}</span>`;

        return `<div class="t-prog-row">
      <span class="t-prog-year">${escapeHtml(yr)}</span>
      ${arrowHtml}
      <span class="t-prog-rank">
        <span>${rankText}</span>
        ${tierIconHtml}
      </span>
    </div>`;
    }).join('');

    const aliasEntries = Object.entries(state.exactLookup[name] ?? {})
        .filter(([yr, exact]) => {
            const slot = slots[yr];

            if (slot && slot.subEntries && slot.subEntries.length > 1) return false;
            return exact !== name;
        })
        .sort(([a], [b]) => a.localeCompare(b));

    const aliasSection = aliasEntries.length > 0
        ? `<hr class="t-sep">
       <div class="t-aliases-header">listed as:</div>` +
        aliasEntries.map(([yr, exact]) =>
            `<div class="t-row"><span>${escapeHtml(yr)}</span><span class="t-alias">${escapeHtml(exact)}</span></div>`
        ).join('')
        : '';

    const hasMultiSubYear = spanYears.some(yr => {
        const slot = slots[yr];
        return slot && slot.subEntries && slot.subEntries.length > 1;
    });

    tooltip.html(`
    <div class="t-name">${escapeHtml(name)}</div>
    ${progRows}
    ${aliasSection}
  `);
    moveTooltip(event.clientX, event.clientY);
    tooltip.classed("tooltip-wide", hasMultiSubYear || aliasEntries.length > 0);
    tooltip.classed("visible", true);
}

function showSplitTooltip(event, primaryName, year) {
    const primarySlot = state.layout.itemSlots[primaryName]?.[year];
    if (!primarySlot?.splitPeers?.length) return;

    const allNames = [primaryName, ...primarySlot.splitPeers];
    const parts = [];
    for (const name of allNames) {
        const slot = state.layout.itemSlots[name]?.[year];
        if (!slot) continue;
        parts.push(blobTooltipInnerHtml(name, year, slot.rank, slot.tier, slot.exact));
    }
    if (!parts.length) return;

    tooltip.html(parts.join('<hr class="t-sep">')).classed("tooltip-wide", parts.length > 1);
    moveTooltip(event.clientX, event.clientY);
    tooltip.classed("visible", true);
}

function moveTooltip(clientX, clientY) {
    const el = tooltip.node();
    const w = el.offsetWidth || 0;
    const h = el.offsetHeight || 0;
    const vw = window.innerWidth;
    const margin = 10;


    const left = Math.min(Math.max(clientX, margin + w / 2), vw - margin - w / 2);


    const flipBelow = (clientY - h - 14) < margin;

    tooltip
        .style("left", left + "px")
        .style("top", clientY + "px")
        .style("transform", `translate(-50%, ${flipBelow ? "14px" : "calc(-100% - 14px)"})`);
}

function hideTooltip() {
    tooltip.classed("visible", false).classed("tooltip-wide", false);
}

function hexToRGBA(hex, alpha) {
    const m = hex.replace("#", "");
    const n = parseInt(m, 16);
    const r = (n >> 16) & 255;
    const g = (n >> 8) & 255;
    const b = n & 255;
    return `rgba(${r},${g},${b},${alpha})`;
}


function visibleColor(hex) {
    const m = hex.replace("#", "");
    const n = parseInt(m, 16);
    let r = ((n >> 16) & 255) / 255;
    let g = ((n >> 8) & 255) / 255;
    let b = (n & 255) / 255;

    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h = 0, s = 0, l = (max + min) / 2;
    if (max !== min) {
        const d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        switch (max) {
            case r:
                h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
                break;
            case g:
                h = ((b - r) / d + 2) / 6;
                break;
            case b:
                h = ((r - g) / d + 4) / 6;
                break;
        }
    }

    const isLight = document.documentElement.classList.contains("light");
    if (isLight) {
        if (l > 0.52) l = Math.max(0.35, l - 0.15);
    } else {
        if (l < 0.58) l = 0.58 + (0.58 - l) * 0.3;
        s = Math.min(1, s * 1.15);
    }

    return `hsl(${Math.round(h * 360)}deg ${Math.round(s * 100)}% ${Math.round(l * 100)}%)`;
}

function escapeHtml(s) {
    return s.replace(/[&<>"']/g, ch => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[ch]));
}


const searchInput = document.getElementById("search");
const suggestions = document.getElementById("suggestions");
const pillsContainer = document.getElementById("pills");
const clearBtn = document.getElementById("clear-btn");

let suggestionIndex = -1;
let searchOpenedByClick = false;

function refreshPills() {
    pillsContainer.innerHTML = "";
    for (const name of state.selected) {
        const color = seriesColor(name);
        const pill = document.createElement("span");
        pill.className = "pill";
        pill.innerHTML = `
      <span class="dot" style="background:${color}"></span>
      <span>${escapeHtml(name)}</span>
      <button title="Remove" aria-label="Remove ${escapeHtml(name)}">×</button>
    `;
        pill.querySelector("button").addEventListener("click", () => {
            state.selected.delete(name);
            refreshPills();
            renderChart();
        });
        pillsContainer.appendChild(pill);
    }
    const hasHiddenItems = state.selected.size > 0;
    const hiddenCount = hasHiddenItems ? Math.max(0, state.allItems.length - state.selected.size) : 0;
    clearBtn.disabled = !hasHiddenItems;
    clearBtn.classList.toggle("has-hidden", hasHiddenItems);
    clearBtn.textContent = hasHiddenItems ? `Show all (${hiddenCount} hidden)` : "Show all";
}

function updateSuggestions({allowOpen = true} = {}) {
    const q = searchInput.value.trim().toLowerCase();
    suggestions.innerHTML = "";
    suggestionIndex = -1;

    if (!state.allItems.length) {
        suggestions.classList.remove("open");
        return;
    }

    const matches = state.allItems
        .filter(n => (!q || n.toLowerCase().includes(q)) && !state.selected.has(n))
        .slice(0, 12);

    if (!matches.length || !allowOpen) {
        suggestions.classList.remove("open");
        return;
    }

    for (const name of matches) {
        const firstObs = state.data.find(d => d.name === name);
        const tierInfo = firstObs ? state.tiers.find(t => t.tier === firstObs.tier) : null;
        const tierColor = tierInfo ? tierInfo.color : "#888";
        const tierLabel = tierInfo ? tierInfo.label : "-";

        const row = document.createElement("div");
        row.className = "suggestion";
        row.innerHTML = `
      <span>${escapeHtml(name)}</span>
      <span class="tier-chip" style="background:${hexToRGBA(tierColor, 0.22)};color:${visibleColor(tierColor)};">${tierLabel}</span>
    `;
        row.addEventListener("click", () => {
            state.selected.add(name);
            searchInput.value = "";
            updateSuggestions();
            refreshPills();
            renderChart();
            searchInput.focus();
        });
        suggestions.appendChild(row);
    }
    suggestions.classList.add("open");
}

searchInput.addEventListener("input", updateSuggestions);
searchInput.addEventListener("pointerdown", () => {
    searchOpenedByClick = true;
});
searchInput.addEventListener("focus", () => {
    updateSuggestions({allowOpen: searchOpenedByClick});
});
searchInput.addEventListener("blur", () => {
    searchOpenedByClick = false;
    setTimeout(() => suggestions.classList.remove("open"), 150);
});
searchInput.addEventListener("keydown", (e) => {
    const items = suggestions.querySelectorAll(".suggestion");
    if (!items.length) return;

    if (e.key === "ArrowDown") {
        e.preventDefault();
        suggestionIndex = Math.min(suggestionIndex + 1, items.length - 1);
        items.forEach((el, i) => el.classList.toggle("active", i === suggestionIndex));
        items[suggestionIndex]?.scrollIntoView({block: "nearest"});
    } else if (e.key === "ArrowUp") {
        e.preventDefault();
        suggestionIndex = Math.max(suggestionIndex - 1, 0);
        items.forEach((el, i) => el.classList.toggle("active", i === suggestionIndex));
        items[suggestionIndex]?.scrollIntoView({block: "nearest"});
    } else if (e.key === "Enter") {
        e.preventDefault();
        const target = suggestionIndex >= 0 ? items[suggestionIndex] : items[0];
        target?.click();
    } else if (e.key === "Escape") {
        searchInput.value = "";
        updateSuggestions();
        searchInput.blur();
    }
});

clearBtn.addEventListener("click", () => {
    state.selected.clear();
    refreshPills();
    renderChart();
});

function toggleItem(name) {
    const peers = state.splitPeerGroups[name] ?? new Set();
    const allNames = [name, ...peers];
    if (state.selected.size === 0 || !state.selected.has(name)) {
        for (const n of allNames) state.selected.add(n);
    } else {
        for (const n of allNames) state.selected.delete(n);
    }
    refreshPills();
    renderChart();
}

const spacingSlider = document.getElementById("spacing-slider");
const spacingVal = document.getElementById("spacing-val");
const yearSelector = document.getElementById("year-selector");
spacingSlider.addEventListener("input", () => {
    state.yearSpacing = parseInt(spacingSlider.value, 10);
    spacingVal.textContent = spacingSlider.value;
    if (!document.getElementById("ui").classList.contains("hidden")) {
        renderChart();
    }
});

yearSelector.addEventListener("change", () => {
    state.selectedYear = yearSelector.value;
    rebuildVisibleData();
    refreshMeta();
    updateSuggestions({allowOpen: false});
    refreshPills();
    renderChart();
});


function boot(typeObj) {
    try {
        const {
            tiers,
            years,
            data,
            tier_labels_by_year: tierLabelsByYear = {},
            year_column_caption: yearColumnCaption = {},
        } = typeObj;
        if (!data.length) throw new Error("No data rows found.");

        state.tierBase = tiers;
        state.allYears = years;
        state.allData = data;
        state.tierLabelsByYear = tierLabelsByYear;
        state.yearColumnCaption = yearColumnCaption;
        state.selectedYear = years[years.length - 1];
        state.exactLookup = {};
        for (const d of data) {
            (state.exactLookup[d.name] ??= {})[d.year] = d.exact ?? d.name;
        }
        state.selected = new Set();
        state.enabledMediaTypes = new Set(MEDIA_TYPE_ORDER);
        buildMediaFilterBar();
        rebuildVisibleData();

        searchInput.value = "";
        updateSuggestions({allowOpen: false});

        yearSelector.innerHTML = "";
        for (const yr of years) {
            const option = document.createElement("option");
            option.value = yr;
            option.textContent = yr;
            yearSelector.appendChild(option);
        }
        yearSelector.value = state.selectedYear;

        refreshMeta();

        document.getElementById("state").classList.add("hidden");
        document.getElementById("ui").classList.remove("hidden");

        refreshPills();
        renderChart();
    } catch (err) {
        showError(err.message);
    }
}


function buildTypeSwitcher(types) {
    const switcher = document.getElementById("type-switcher");
    switcher.innerHTML = "";
    for (const typeInfo of types) {
        const btn = document.createElement("button");
        btn.className = "type-btn";
        btn.textContent = typeInfo.label;
        btn.dataset.typeId = typeInfo.id;
        btn.addEventListener("click", () => loadType(typeInfo));
        switcher.appendChild(btn);
    }
    switcher.classList.remove("hidden");
    state.manifestTypes = types;
}

function sortTypesByPreferredOrder(types) {
    const rank = new Map(TYPE_DISPLAY_ORDER.map((id, idx) => [id, idx]));
    return [...types].sort((a, b) => {
        const aRank = rank.has(a.id) ? rank.get(a.id) : Number.MAX_SAFE_INTEGER;
        const bRank = rank.has(b.id) ? rank.get(b.id) : Number.MAX_SAFE_INTEGER;
        if (aRank !== bRank) return aRank - bRank;
        return (a.label || a.id).localeCompare(b.label || b.id);
    });
}

function setActiveTypeButton(typeId) {
    document.querySelectorAll(".type-btn").forEach(btn => {
        btn.classList.toggle("active", btn.dataset.typeId === typeId);
    });
}

function loadType(typeObj) {
    state.currentTypeId = typeObj.id;
    setActiveTypeButton(typeObj.id);
    document.getElementById("title-type").textContent = typeObj.label;
    boot(typeObj);
    document.getElementById("subtitle").textContent =
        "Aleczandxr's personal favourites ranked";
}


function showError(msg) {
    document.getElementById("state").classList.remove("hidden");
    document.getElementById("ui").classList.add("hidden");
    document.getElementById("state").innerHTML = `
    <h2>Couldn't load the data</h2>
    <p>${escapeHtml(msg)}</p>
    <p class="muted">This usually means the browser blocked <code>fetch()</code> on local files (a CORS restriction with <code>file://</code>).<br>
    Add <code>rankings_data.json</code> below, or start a tiny local server -
    e.g. <code>python3 -m http.server</code> - and open <code>http://localhost:8000/index.html</code>.</p>
    <label class="file-drop" id="drop">
      <strong>Click to choose</strong> <code>rankings_data.json</code> here
      <input type="file" id="file-input" accept=".json,application/json">
    </label>
  `;

    const drop = document.getElementById("drop");
    const fileInput = document.getElementById("file-input");

    fileInput.addEventListener("change", e => {
        const f = e.target.files[0];
        if (f) readFile(f);
    });
    ["dragenter", "dragover"].forEach(ev =>
        drop.addEventListener(ev, e => {
            e.preventDefault();
            drop.classList.add("drag");
        }));
    ["dragleave", "drop"].forEach(ev =>
        drop.addEventListener(ev, e => {
            e.preventDefault();
            drop.classList.remove("drag");
        }));
    drop.addEventListener("drop", e => {
        e.preventDefault();
        const f = e.dataTransfer.files[0];
        if (f) readFile(f);
    });
}

function readFile(file) {
    const reader = new FileReader();
    reader.onload = e => {
        try {
            initFromJSON(JSON.parse(e.target.result));
        } catch {
            showError("Failed to parse JSON file.");
        }
    };
    reader.onerror = () => showError("Failed to read file.");
    reader.readAsText(file);
}


let resizeTimer;
window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
        if (!document.getElementById("ui").classList.contains("hidden")) {
            renderChart();
        }
    }, 160);
});


const themeToggleBtn = document.getElementById("theme-toggle");
const iconSun = document.getElementById("icon-sun");
const iconMoon = document.getElementById("icon-moon");

function applyTheme(mode) {
    const isLight = mode === "light";
    document.documentElement.classList.toggle("light", isLight);
    iconSun.style.display = isLight ? "none" : "";
    iconMoon.style.display = isLight ? "" : "none";
    themeToggleBtn.title = isLight ? "Switch to dark mode" : "Switch to light mode";
    if (!document.getElementById("ui").classList.contains("hidden")) {
        renderChart();
    }
}

applyTheme(localStorage.getItem("theme") || "dark");

themeToggleBtn.addEventListener("click", () => {
    const next = document.documentElement.classList.contains("light") ? "dark" : "light";
    localStorage.setItem("theme", next);
    applyTheme(next);
});


function initFromJSON(json) {
    const types = sortTypesByPreferredOrder(json.types || []);
    if (!types.length) {
        showError("rankings_data.json has no types.");
        return;
    }
    buildTypeSwitcher(types);
    loadType(types[0]);
}

fetch("rankings_data.json")
    .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
    })
    .then(initFromJSON)
    .catch(err => showError(err.message || "Could not load rankings_data.json"));
