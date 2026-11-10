(() => {
  "use strict";

  const seatCount = 10;
  const legacyMultiCount = 5;
  const drawDuration = 9000;
  const drawPhases = [
    { key: "warmup", label: "抽选启动", caption: "抽选启动 / STARTING", intervals: [460, 390, 325, 275, 225, 175] },
    { key: "rush", label: "高速抽选", caption: "高速抽选 / IN MOTION", intervals: Array(36).fill(88) },
    { key: "slow", label: "即将锁定", caption: "即将锁定 / SLOWING DOWN", intervals: [130, 155, 190, 230, 280, 350, 445, 545, 720] },
  ];
  const storageKey = "lucky-card-stage.v1";
  const archive = window.DrawArchive;
  const rosterTools = window.DrawRoster;
  const musicTracks = ["comic", "detective", "arcade"];
  const formatNumber = (number) => String(number).padStart(2, "0");
  const sampleNames = Array.from({ length: seatCount }, (_, index) => `星宸 ${formatNumber(index + 1)}`);
  const legacySampleName = (seat) => `选手 ${formatNumber(seat + 1)}`;
  const initialState = () => ({ round: 1, roster: [...sampleNames], results: [], music: true, musicTrack: "rotate" });
  const get = (id) => document.getElementById(id);
  const motion = matchMedia("(prefers-reduced-motion: reduce)");
  let state = load();
  let drawStartedAt = null;
  let drawQueued = false;
  let storageWritable = true;
  let activeDrawTrack;
  let pendingWinnerReveal;

  const stage = get("stage");
  const deck = get("cards");
  const signalName = get("signal-name");
  const signalCode = get("signal-code");
  const signalMode = get("signal-mode");
  const signalIndex = get("signal-index");
  const rosterButton = get("edit-roster");
  const historyButton = get("open-history");
  const drawButton = get("draw-button");
  const soundButton = get("toggle-sound");
  const musicTrackSelect = get("music-track");
  const screenButton = get("toggle-screen");
  const rosterDialog = get("roster-dialog");
  const historyDialog = get("history-dialog");
  const winnerDialog = get("winner-dialog");
  const drawModeDialog = get("draw-mode-dialog");
  const drawAllButton = get("draw-all");
  const drawModeHint = get("draw-mode-hint");
  const multiResults = get("multi-results");
  const multiResultList = get("multi-result-list");
  const winnerMultiResults = get("winner-multi-results");
  const namesInput = get("names-input");
  const rosterCount = get("roster-count");
  const rosterError = get("roster-error");
  const saveRoster = get("save-roster");
  const groupStatus = get("roster-group-status");
  const rosterEditScope = get("roster-edit-scope");
  const historyList = get("history-list");
  const historyExport = get("history-export");
  const historyBackup = get("history-backup");
  const historyRestore = get("history-restore");
  const historyFile = get("history-file");
  const autoBackupButton = get("history-autobackup");
  const historyStorageStatus = get("history-storage-status");
  let backupStatus = "unbound";
  const fileBackup = archive.createFileBackup({
    getRecords: historyRecords,
    mergeRecords: restoreRecords,
    onStatus: renderBackupStatus,
  });

  function load() {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey));
      if (saved && Number.isSafeInteger(saved.round) && saved.round > 0 &&
          Array.isArray(saved.roster) && saved.roster.length === seatCount &&
          saved.roster.every((name) => typeof name === "string" && name.trim()) &&
          Array.isArray(saved.results)) {
        saved.results = archive.merge(saved.results);
        if (!rosterTools.validBatch(saved.batch, seatCount) ||
            !saved.roster.every((name, seat) => name === saved.batch.groups[saved.batch.index][seat])) {
          delete saved.batch;
        }
        if (validMultiDraw(saved.multiDraw, saved.batch, saved.results, saved.round)) {
          saved.multiDraw.count ??= legacyMultiCount;
        } else {
          delete saved.multiDraw;
        }
        if (!rosterTools.validBatch({ groups: saved.nextGroups, index: 0 }, seatCount)) delete saved.nextGroups;
        if (!saved.batch && saved.roster.every((name, seat) => name === legacySampleName(seat)) &&
            !saved.results.some((result) => result.round === saved.round)) {
          saved.roster = [...sampleNames];
        }
        if (typeof saved.music !== "boolean") saved.music = true;
        if (!musicTracks.includes(saved.musicTrack)) saved.musicTrack = "rotate";
        return saved;
      }
    } catch {
      // Storage may be unavailable in a restricted browser.
    }
    return initialState();
  }

  function validMultiDraw(multi, batch, results, round) {
    const count = multi?.count ?? legacyMultiCount;
    if (!multi || !batch || !Number.isSafeInteger(count) || count < 2 ||
        !Number.isSafeInteger(multi.firstGroup) || multi.firstGroup < 0 ||
        count > batch.groups.length - multi.firstGroup || !Array.isArray(multi.resultIds) ||
        multi.resultIds.length > count || new Set(multi.resultIds).size !== multi.resultIds.length) return false;

    const groupOffset = batch.index - multi.firstGroup;
    if (groupOffset < 0 || groupOffset >= count ||
        (groupOffset !== multi.resultIds.length && groupOffset !== multi.resultIds.length - 1)) return false;

    const records = new Map(results.map((record) => [record.id, record]));
    return multi.resultIds.every((id, offset) => {
      if (typeof id !== "string" || !id) return false;
      const result = records.get(id);
      return result && batch.groups[multi.firstGroup + offset][result.seat] === result.name &&
        (offset !== groupOffset || result.round === round);
    });
  }

  function persist() {
    state.results = historyRecords();
    return writeState(state);
  }

  function writeState(snapshot) {
    try {
      localStorage.setItem(storageKey, JSON.stringify(snapshot));
      if (snapshot === state) storageWritable = true;
      return true;
    } catch {
      if (snapshot === state) storageWritable = false;
      document.querySelector(".foot span:last-child").textContent = "浏览器保存不可用，请下载记录备份";
      return false;
    }
  }

  function historyRecords() {
    return archive.merge(state.results, load().results);
  }

  function icon(name, className = "icon") {
    const ns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(ns, "svg");
    const use = document.createElementNS(ns, "use");
    svg.setAttribute("class", className);
    svg.setAttribute("aria-hidden", "true");
    use.setAttribute("href", `#i-${name}`);
    svg.append(use);
    return svg;
  }

  function currentResult(drawState = state) {
    const multi = drawState.multiDraw;
    const resultId = multi?.resultIds[drawState.batch.index - multi.firstGroup];
    if (resultId) return drawState.results.find((result) => result.id === resultId) ?? null;
    return drawState.results.findLast((result) =>
      result.round === drawState.round && result.name === drawState.roster[result.seat]
    ) ?? null;
  }

  function drawProgress(drawState) {
    const result = currentResult(drawState);
    const { round, roster, batch, nextGroups, multiDraw } = drawState;
    return JSON.stringify([
      round, roster, batch?.index, batch?.groups, nextGroups,
      multiDraw?.firstGroup, multiDraw?.count, multiDraw?.resultIds,
      result?.id, result?.seat, result?.name,
    ]);
  }

  function changedDrawProgress() {
    if (!storageWritable) return;
    try {
      localStorage.getItem(storageKey);
    } catch {
      return;
    }
    const latest = load();
    if (drawProgress(latest) !== drawProgress(state)) return latest;
  }

  function adoptDrawProgress(latest) {
    state = latest;
    renderRound();
    renderSound();
  }

  function checkDrawProgress() {
    const latest = changedDrawProgress();
    if (!latest) return true;
    adoptDrawProgress(latest);
    setStatus("名单或开奖记录已更新", "本次未开始抽奖。请核对当前名单后重新开始。");
    drawButton.focus({ preventScroll: true });
    return false;
  }

  function setStatus(title, detail, symbol = "star") {
    get("status-title").textContent = title;
    get("status-detail").textContent = detail;
    get("status-symbol").replaceChildren(icon(symbol));
  }

  function showSignal(name, code, mode, seat) {
    signalName.textContent = name;
    signalName.classList.toggle("is-long", [...name].length > 8);
    signalCode.textContent = code;
    signalMode.textContent = mode;
    signalIndex.textContent = seat == null ? "— / 10" : `${formatNumber(seat + 1)} / 10`;
  }

  function renderRound(options) {
    renderLineup(state.roster, state.round, state.batch);
    musicTrackSelect.disabled = false;
    renderMusicChoice();

    const result = currentResult();
    if (result) {
      renderWinner(result, options);
      return;
    }

    stage.classList.remove("is-won");
    renderMultiSummary([]);
    showSignal("等待开奖", "READY TO DRAW", "待命");
    rosterButton.disabled = false;
    historyButton.disabled = false;
    drawButton.disabled = false;
    get("draw-label").textContent = multiPending() ? "继续抽奖" : "开始抽奖";
    const usingSamples = state.roster.every((name, index) => name === sampleNames[index]);
    setStatus("准备就绪", usingSamples ? "正在使用示例名单，可替换为现场名单。" : "名单已就绪，点击开始揭晓。");
  }

  function renderLineup(roster, round, batch, groupIndex = batch?.index, count = 1) {
    get("round-number").textContent = formatNumber(round);
    groupStatus.hidden = !batch;
    if (batch) {
      const range = count > 1 ? `${groupIndex + 1}–${groupIndex + count}` : groupIndex + 1;
      groupStatus.textContent = `第 ${range} / ${batch.groups.length} 组`;
    }
    const cards = roster.map((name, index) => {
      const card = document.createElement("li");
      card.className = "card";

      const number = document.createElement("span");
      number.className = "card-number";
      number.textContent = formatNumber(index + 1);

      const label = document.createElement("strong");
      label.className = "card-name";
      label.textContent = name;
      card.title = name;
      card.append(number, label);
      return card;
    });
    deck.replaceChildren(...cards);
  }

  function renderWinner(result, { reveal = false, track = trackForRound() } = {}) {
    const winnerCard = deck.children[result.seat];
    const details = `第 ${formatNumber(result.round)} 轮 · ${formatNumber(result.seat + 1)} 号`;
    const remaining = remainingGroups();
    const needsNewRoster = remaining === 0;
    const nextRosterNote = remaining && (state.batch || state.nextGroups) ? ` · 待抽 ${remaining} 组` : "";
    const summary = completedMultiResults();
    stage.classList.remove("is-drawing");
    delete stage.dataset.phase;
    stage.classList.add("is-won");
    renderMultiSummary(summary);
    winnerCard.classList.add("is-winner");
    winnerCard.setAttribute("aria-label", `${formatNumber(result.seat + 1)} 号 ${result.name}，本轮中奖`);
    showSignal(result.name, "宸团来道贺！", "已揭晓", result.seat);
    if (summary.length) setStatus(`${summary.length} 组开奖完成`, `${summary.length} 位中奖者已记入中奖记录${nextRosterNote}`, "trophy");
    else setStatus(`恭喜 ${result.name}！`, details + nextRosterNote, "trophy");
    drawButton.disabled = false;
    rosterButton.disabled = false;
    historyButton.disabled = false;
    musicTrackSelect.disabled = false;
    const startLabel = multiPending() ? "继续抽奖" : "开始抽奖";
    get("draw-label").textContent = needsNewRoster ? "录入新名单" : startLabel;
    get("winner-next-label").textContent = needsNewRoster ? (summary.length ? "查看中奖名单" : "完成本批") : startLabel;

    if (!reveal) return;
    const announcement = { result, details, summary, track };
    if (rosterDialog.open) pendingWinnerReveal = announcement;
    else showWinnerPopup(announcement);
  }

  function showWinnerPopup({ result, details, summary, track }) {
    const musicOptions = { sound: state.music, track };
    if (typeof winnerDialog?.showModal === "function") {
      const winnerName = get("winner-name");
      const isMulti = summary.length > 0;
      winnerDialog.classList.toggle("is-multi", isMulti);
      winnerName.textContent = isMulti ? "" : result.name;
      get("winner-meta").textContent = isMulti ? `本次共抽出 ${summary.length} 位中奖者` : details;
      winnerMultiResults.hidden = !isMulti;
      renderWinnerList(winnerMultiResults, summary);
      winnerDialog.returnValue = "";
      winnerDialog.showModal();
      window.DrawEffects.celebrate(get("winner-confetti"), { ...musicOptions, origin: isMulti ? winnerMultiResults : winnerName });
    } else {
      window.DrawEffects.celebrate(get("confetti"), { ...musicOptions, origin: signalName });
    }
  }

  function multiPending() {
    return Boolean(state.multiDraw && state.multiDraw.resultIds.length < state.multiDraw.count);
  }

  function completedMultiResults() {
    if (!state.multiDraw || multiPending()) return [];
    const records = new Map(state.results.map((result) => [result.id, result]));
    return state.multiDraw.resultIds.map((id) => records.get(id)).filter(Boolean);
  }

  function renderMultiSummary(results) {
    stage.classList.toggle("is-multi", results.length > 0);
    multiResults.hidden = results.length === 0;
    get("multi-results-label").textContent = results.length ? `${results.length} 组中奖名单` : "中奖名单";
    renderWinnerList(multiResultList, results);
  }

  function renderWinnerList(target, results) {
    const rows = document.createDocumentFragment();
    for (const result of results) {
      const row = document.createElement("li");
      const round = document.createElement("span");
      round.className = "multi-result-round";
      round.textContent = `第 ${formatNumber(result.round)} 轮`;
      const name = document.createElement("strong");
      name.className = "multi-result-name";
      name.textContent = result.name;
      row.append(round, name);
      rows.append(row);
    }
    target.replaceChildren(rows);
  }

  function randomIndex(size) {
    const random = new Uint32Array(1);
    const limit = 2 ** 32 - (2 ** 32 % size);
    do {
      crypto.getRandomValues(random);
    } while (random[0] >= limit);
    return random[0] % size;
  }

  const waitUntil = (time) => new Promise((resolve) => setTimeout(resolve, Math.max(0, time - performance.now())));

  async function rollNames(start, rosters) {
    const cards = Array.from(deck.children);
    const groupCount = rosters.length;
    const poolSize = seatCount * groupCount;
    let active = randomIndex(poolSize);
    let deadline = start;

    for (const phase of drawPhases) {
      stage.dataset.phase = phase.key;
      if (motion.matches) {
        showSignal("正在抽选", phase.caption, phase.label);
        deadline += phase.intervals.reduce((total, interval) => total + interval, 0);
        await waitUntil(deadline);
        continue;
      }

      for (const interval of phase.intervals) {
        deadline += interval;
        if (deadline > performance.now()) {
          const seat = Math.floor(active / groupCount);
          const card = groupCount === 1 ? cards[seat] : null;
          showSignal(rosters[active % groupCount][seat], phase.caption, phase.label, card ? seat : undefined);
          card?.classList.add("is-active");
          await waitUntil(deadline);
          card?.classList.remove("is-active");
        }
        active = (active + 1) % poolSize;
      }
    }

    stage.dataset.phase = "hold";
    showSignal("即将揭晓", "结果已锁定 / LOCKED", "已锁定");
    await waitUntil(start + drawDuration);
  }

  function eligiblePeople(roster, winners) {
    const people = new Map();
    roster.forEach((name, seat) => {
      const identity = rosterTools.identity(name);
      if (winners.has(identity)) return;
      if (!people.has(identity)) people.set(identity, []);
      people.get(identity).push(seat);
    });
    return people;
  }

  function shuffledSeats(previousSeat) {
    const seats = Array.from({ length: seatCount }, (_, seat) => seat);
    for (let index = seats.length - 1; index > 0; index -= 1) {
      const other = randomIndex(index + 1);
      [seats[index], seats[other]] = [seats[other], seats[index]];
    }
    // Each seat is still equally likely before the draw, including across block boundaries.
    if (seats[0] === previousSeat) {
      const other = 1 + randomIndex(seatCount - 1);
      [seats[0], seats[other]] = [seats[other], seats[0]];
    }
    return seats;
  }

  function chooseWinningSeats(rosters, history) {
    const winners = new Set(history.map((record) => rosterTools.identity(record.name)));
    const groups = rosters.map((roster) => eligiblePeople(roster, winners));
    const emptyGroup = groups.findIndex((group) => group.size === 0);
    if (emptyGroup >= 0) return { blocked: emptyGroup };

    const seats = [];
    const fullGroups = groups.length > 1 && groups.every((group) => group.size === seatCount) &&
      new Set(groups.flatMap((group) => [...group.keys()])).size === groups.length * seatCount;
    if (fullGroups) {
      while (seats.length < groups.length) {
        seats.push(...shuffledSeats(seats.at(-1)).slice(0, groups.length - seats.length));
      }
    } else {
      for (const [groupIndex, group] of groups.entries()) {
        const available = [...group].filter(([name]) => !winners.has(name));
        if (!available.length) return { blocked: groupIndex };
        const [name, positions] = available[randomIndex(available.length)];
        winners.add(name);
        seats.push(positions.length === 1 ? positions[0] : positions[randomIndex(positions.length)]);
      }
    }
    return { seats };
  }

  function resultForSeat(round, participants, timestamp, seat) {
    return {
      round,
      seat,
      name: participants[seat],
      participants: [...participants],
      id: crypto.randomUUID?.() ?? Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) =>
        byte.toString(16).padStart(2, "0")
      ).join(""),
      timestamp,
    };
  }

  function prepareDraw(count) {
    if (drawStartedAt !== null || !Number.isSafeInteger(count) || count < 1 || count > remainingGroups()) return;
    const pending = multiPending() ? state.multiDraw : null;
    if (pending && count !== pending.count - pending.resultIds.length) return;

    const finished = Boolean(currentResult());
    const nextGroups = state.nextGroups;
    const batch = nextGroups ? (nextGroups.length > 1 ? { groups: nextGroups, index: 0 } : undefined) : state.batch;
    const startIndex = nextGroups || !batch ? 0 : batch.index + Number(finished);
    const singleRoster = finished && state.roster.every((name, seat) => name === legacySampleName(seat)) ?
      sampleNames : state.roster;
    const rosters = batch ? batch.groups.slice(startIndex, startIndex + count) : [nextGroups?.[0] ?? singleRoster];
    const history = historyRecords();
    const { seats, blocked } = chooseWinningSeats(rosters, history);
    if (!seats) {
      const group = batch ? `第 ${startIndex + blocked + 1} 组` : "本组";
      const action = count > 1 && !pending ? "请编辑名单，或改为「一组一次」。" : "请编辑名单后再试。";
      setStatus("本次未开始抽奖", `${group}没有可抽的参与者。已中奖者会自动排除。${action}`);
      rosterButton.focus({ preventScroll: true });
      return;
    }
    const usedRounds = new Set(history.map((record) => record.round));
    const firstRound = finished || usedRounds.has(state.round) ? nextRound(history) : state.round;
    const timestamp = new Date().toISOString();
    let round = firstRound;
    const results = rosters.map((roster, index) => {
      const result = resultForSeat(round, roster, timestamp, seats[index]);
      usedRounds.add(round);
      round = unusedRound(round < Number.MAX_SAFE_INTEGER ? round + 1 : 1, usedRounds);
      return result;
    });
    const last = results.at(-1);
    const track = trackForRound(firstRound);

    stage.classList.remove("is-won");
    renderMultiSummary([]);
    renderLineup(rosters[0], firstRound, batch, startIndex, count);

    drawStartedAt = performance.now();
    activeDrawTrack = track;
    stage.style.setProperty("--draw-duration", `${drawDuration}ms`);
    stage.classList.add("is-drawing");
    drawButton.disabled = true;
    historyButton.disabled = true;
    musicTrackSelect.disabled = true;
    get("draw-label").textContent = "抽选中";
    if (state.music) window.DrawEffects.beginDraw(drawDuration, 0, track);

    state.results = history.concat(results);
    state.round = last.round;
    state.roster = [...last.participants];
    if (batch) state.batch = { groups: batch.groups, index: startIndex + count - 1 };
    else delete state.batch;
    delete state.nextGroups;
    if (pending || count > 1) {
      state.multiDraw = {
        firstGroup: pending?.firstGroup ?? startIndex,
        count: pending?.count ?? count,
        resultIds: (pending?.resultIds ?? []).concat(results.map((result) => result.id)),
      };
    } else {
      delete state.multiDraw;
    }
    persist();
    void fileBackup.sync();

    const drawingGroups = pending || count > 1;
    setStatus(drawingGroups ? `正在抽选 ${count} 组` : "抽选进行中",
      drawingGroups ? "约 9 秒后一次揭晓全部结果。" : "本轮将在约 9 秒后揭晓。");
    return { rosters, track };
  }

  async function draw(count) {
    if (drawStartedAt !== null || drawQueued) return;
    drawQueued = true;
    const prepare = () => {
      if (!rosterDialog.open && checkDrawProgress()) return prepareDraw(count);
    };
    let animation;
    try {
      if (window.navigator?.locks && state.music) void window.DrawEffects.primeSound();
      animation = await withStateLock(prepare);
    } finally {
      drawQueued = false;
    }
    if (!animation) return;
    const { rosters, track } = animation;
    await rollNames(drawStartedAt, rosters);
    drawStartedAt = null;
    activeDrawTrack = undefined;
    renderRound({ reveal: true, track });
  }

  async function withStateLock(operation) {
    const locks = window.navigator?.locks;
    if (!locks) return operation();
    let entered = false;
    try {
      return await locks.request(storageKey + ".draw", () => {
        entered = true;
        return operation();
      });
    } catch (error) {
      if (entered) throw error;
      return operation();
    }
  }

  function remainingGroups() {
    if (state.nextGroups) return state.nextGroups.length;
    if (!state.batch) return 1;
    return state.batch.groups.length - state.batch.index - (currentResult() ? 1 : 0);
  }

  function openDrawMode() {
    const remaining = remainingGroups();
    drawAllButton.disabled = false;
    get("draw-all-count").textContent = formatNumber(remaining);
    get("draw-all-label").textContent = `${remaining}组${remaining}次`;
    drawModeHint.textContent = `剩余 ${remaining} 组名单。抽完剩余组时，所有结果会同时揭晓。`;
    drawModeDialog.showModal();
  }

  function startDrawMode(count) {
    if (!drawModeDialog.open || drawStartedAt !== null || multiPending() || count < 1 || count > remainingGroups()) return;
    drawModeDialog.close();
    void draw(count);
  }

  function handleNext() {
    if (drawStartedAt !== null || drawQueued) return;
    if (multiPending()) void draw(state.multiDraw.count - state.multiDraw.resultIds.length);
    else {
      const remaining = remainingGroups();
      if (remaining === 0) openRoster();
      else if (remaining === 1) void draw(1);
      else openDrawMode();
    }
  }

  function lastGroup() {
    return Boolean(state.batch && state.batch.index === state.batch.groups.length - 1);
  }

  function rosterDraft() {
    const names = rosterTools.parse(namesInput.value);
    const groups = rosterTools.groups(names, seatCount);
    return {
      names,
      groups,
      duplicateGroup: groups.findIndex((group) => rosterTools.duplicates(group).length > 0),
      remainder: names.length % seatCount,
      longName: names.some((name) => name.length > archive.maxNameLength),
    };
  }

  function updateRosterCount() {
    const { names, duplicateGroup, remainder, longName } = rosterDraft();
    const count = names.length;
    const fullGroups = Math.floor(count / seatCount);
    rosterCount.textContent = `${count} 人 · ${fullGroups} 组`;
    rosterError.textContent = longName ? "名单中有过长的姓名，请缩短后再保存。" :
      remainder ? `最后一组有 ${remainder} 人，还需 ${seatCount - remainder} 人才能凑满一组。` :
      duplicateGroup >= 0 ? `名单第 ${duplicateGroup + 1} 组有重复姓名。同名不同参与者请在姓名后加不同编号。` : "";
    rosterError.hidden = !longName && remainder === 0 && duplicateGroup < 0;
    namesInput.setAttribute("aria-invalid", String(!rosterError.hidden));
    saveRoster.disabled = count === 0 || !rosterError.hidden;
    saveRoster.textContent = fullGroups > 1 && !saveRoster.disabled ? `保存 ${fullGroups} 组名单` : "保存名单";
  }

  function openRoster() {
    if (drawStartedAt === null) {
      const latest = changedDrawProgress();
      if (latest) adoptDrawProgress(latest);
    }
    const finished = Boolean(currentResult());
    let names = state.roster;
    let scope = "";
    if (state.nextGroups) {
      names = state.nextGroups.flat();
      scope = "下方名单将用于下一次抽奖。";
    } else if (state.batch) {
      const start = state.batch.index + Number(finished);
      names = state.batch.groups.slice(start).flat();
      if (start > 0) scope = names.length ? `已有 ${start} 组结果锁定。下方只编辑待抽名单。` : "本批结果已锁定。请录入下一批名单。";
    } else if (finished) {
      scope = "本轮结果已锁定。保存后的名单将用于下一轮。";
    }
    rosterEditScope.hidden = !scope;
    rosterEditScope.textContent = scope;
    namesInput.value = names.map((name, index) => `${index + 1}. ${name}`).join("\n");
    updateRosterCount();
    rosterDialog.showModal();
  }

  rosterButton.addEventListener("click", openRoster);
  rosterDialog.addEventListener("close", () => {
    if (rosterDialog.open || !pendingWinnerReveal) return;
    const announcement = pendingWinnerReveal;
    pendingWinnerReveal = undefined;
    showWinnerPopup(announcement);
  });
  namesInput.addEventListener("input", updateRosterCount);
  get("demo-names").addEventListener("click", () => {
    namesInput.value = sampleNames.join("\n");
    updateRosterCount();
    namesInput.focus();
  });
  get("roster-form").addEventListener("submit", (event) => {
    event.preventDefault();
    void withStateLock(saveRosterDraft);
  });

  function saveRosterDraft() {
    const { names, groups, duplicateGroup, remainder, longName } = rosterDraft();
    if (!rosterDialog.open || !names.length || remainder || longName || duplicateGroup >= 0) return;
    if (changedDrawProgress()) {
      rosterError.hidden = false;
      rosterError.textContent = "另一个页面已更新名单或开奖记录。请保留当前输入，关闭后重新打开编辑名单。";
      return;
    }
    const finished = Boolean(currentResult());
    if (state.nextGroups || (finished && (!state.batch || lastGroup()))) {
      state.nextGroups = groups;
    } else if (state.batch) {
      const start = state.batch.index + Number(finished);
      state.batch.groups = state.batch.groups.slice(0, start).concat(groups);
      if (!finished) state.roster = [...groups[0]];
      if (multiPending()) {
        state.multiDraw.count = Math.min(state.multiDraw.count, state.batch.groups.length - state.multiDraw.firstGroup);
        if (state.multiDraw.count < 2) delete state.multiDraw;
      }
    } else {
      if (groups.length > 1) state.batch = { groups, index: 0 };
      state.roster = [...groups[0]];
    }
    persist();
    if (drawStartedAt === null) renderRound();
    rosterDialog.close();
  }

  function renderHistory() {
    const records = historyRecords();
    const rows = document.createDocumentFragment();
    for (const result of records.reverse()) {
      const row = document.createElement("li");
      const round = document.createElement("span");
      round.className = "draw-history__round";
      round.textContent = `第 ${formatNumber(result.round)} 轮`;
      const winner = document.createElement("strong");
      winner.className = "draw-history__winner";
      winner.textContent = result.name;
      const seat = document.createElement("span");
      seat.className = "draw-history__seat";
      seat.textContent = `${formatNumber(result.seat + 1)} 号`;
      row.append(round, winner, seat);
      rows.append(row);
    }
    const hasRecords = records.length > 0;
    historyList.replaceChildren(rows);
    if (hasRecords) historyList.tabIndex = 0;
    else historyList.removeAttribute("tabindex");
    get("history-empty").hidden = hasRecords;
    historyExport.disabled = !hasRecords;
    historyBackup.disabled = !hasRecords;
  }

  function historyNotice(message, error = false) {
    historyStorageStatus.textContent = message;
    historyStorageStatus.dataset.tone = error ? "error" : "normal";
  }

  function renderBackupStatus(code, detail) {
    backupStatus = code;
    autoBackupButton.disabled = code === "unsupported" || code === "saving";
    autoBackupButton.textContent = code === "permission-needed" ? "重新连接备份文件" :
      code === "synced" ? "更换备份文件" : "自动备份到文件";
    const messages = {
      unsupported: "当前浏览器可手动下载和恢复备份。",
      unbound: "自动文件备份未启用。",
      "permission-needed": "浏览器需要重新授权，备份文件里的记录仍然保留。",
      saving: "正在写入本地备份文件…",
      synced: "已更新本地备份文件。每次开奖后会自动写入。",
      error: detail || "备份文件写入失败，请重试。",
    };
    historyNotice(messages[code], code === "error");
  }

  function nextRound(records) {
    const lastRound = Math.max(state.round, records.at(-1)?.round ?? 0);
    if (lastRound < Number.MAX_SAFE_INTEGER) return lastRound + 1;
    return unusedRound(1, new Set(records.map((record) => record.round)));
  }

  function unusedRound(round, usedRounds) {
    while (usedRounds.has(round)) round = round < Number.MAX_SAFE_INTEGER ? round + 1 : 1;
    return round;
  }

  function restoreRecords(records) {
    return withStateLock(() => mergeRestoredRecords(records));
  }

  function mergeRestoredRecords(records) {
    const latest = changedDrawProgress();
    const previous = historyRecords();
    const finished = currentResult();
    state.results = archive.merge(previous, records);
    const latestRound = state.results.at(-1)?.round ?? 0;
    if (!latest && drawStartedAt === null && !((state.batch || state.nextGroups) && finished) &&
        (latestRound > state.round || (latestRound === state.round && !finished))) {
      state.round = nextRound(state.results);
      renderRound();
    }
    const saved = latest ? writeState({ ...latest, results: state.results }) : persist();
    if (historyDialog.open) renderHistory();
    return { added: state.results.length - previous.length, saved };
  }

  function datedFilename(label, extension) {
    const date = new Date();
    return `${label}-${date.getFullYear()}-${formatNumber(date.getMonth() + 1)}-${formatNumber(date.getDate())}.${extension}`;
  }

  historyButton.addEventListener("click", () => {
    renderHistory();
    historyDialog.showModal();
  });

  historyExport.addEventListener("click", () => {
    archive.download(datedFilename("中奖记录", "csv"), archive.csv(historyRecords()), "text/csv;charset=utf-8");
  });
  historyBackup.addEventListener("click", () => {
    try {
      archive.download(datedFilename("中奖记录备份", "json"), archive.serialize(historyRecords()), "application/json");
    } catch (error) {
      historyNotice(error.message, true);
    }
  });
  historyRestore.addEventListener("click", () => historyFile.click());
  historyFile.addEventListener("change", async () => {
    const file = historyFile.files[0];
    historyFile.value = "";
    if (!file) return;
    try {
      if (file.size > archive.maxBackupBytes) throw new Error("此备份文件过大，无法读取。");
      const records = archive.parse(await file.text());
      const { added, saved } = await restoreRecords(records);
      const summary = added ? `已恢复 ${added} 条中奖记录。` : "备份中的记录已全部存在。";
      historyNotice(saved ? summary : summary + " 浏览器保存不可用，请保留备份文件。", !saved);
      void fileBackup.sync();
    } catch (error) {
      historyNotice(error.message || "无法恢复这份备份。", true);
    }
  });
  autoBackupButton.addEventListener("click", () => {
    if (backupStatus === "permission-needed") void fileBackup.reconnect();
    else void fileBackup.bind();
  });
  window.addEventListener("storage", (event) => {
    if (event.key === storageKey && historyDialog.open) renderHistory();
  });

  document.querySelectorAll("[data-close-dialog]").forEach((button) => {
    button.addEventListener("click", () => get(button.dataset.closeDialog).close());
  });

  get("winner-next")?.addEventListener("click", () => {
    if (!winnerDialog.open || !currentResult()) return;
    winnerDialog.close(remainingGroups() ? "start" : "");
  });
  get("winner-edit-roster")?.addEventListener("click", () => {
    if (winnerDialog.open) winnerDialog.close("edit-roster");
  });
  winnerDialog?.addEventListener("close", () => {
    if (winnerDialog.returnValue === "edit-roster") openRoster();
    else if (winnerDialog.returnValue === "start") handleNext();
    else drawButton.focus({ preventScroll: true });
  });
  get("draw-once").addEventListener("click", () => startDrawMode(1));
  drawAllButton.addEventListener("click", () => {
    const count = remainingGroups();
    if (count > 1) startDrawMode(count);
  });

  function renderSound() {
    soundButton.setAttribute("aria-pressed", String(state.music));
    soundButton.title = state.music ? "关闭音乐" : "开启音乐";
    soundButton.replaceChildren(icon(state.music ? "sound" : "muted"));
  }

  function trackForRound(round = state.round) {
    return state.musicTrack === "rotate" ? musicTracks[(round - 1) % musicTracks.length] : state.musicTrack;
  }

  function renderMusicChoice() {
    musicTrackSelect.value = state.musicTrack;
    const track = Array.from(musicTrackSelect.options).find((option) => option.value === trackForRound());
    musicTrackSelect.title = `本轮配乐：${track.textContent}`;
  }

  function persistPreferences(changes) {
    return withStateLock(() => {
      if (storageWritable) return writeState({ ...load(), ...changes });
    });
  }

  musicTrackSelect.addEventListener("change", () => {
    state.musicTrack = musicTrackSelect.value;
    void persistPreferences({ musicTrack: state.musicTrack });
    renderMusicChoice();
  });

  soundButton.addEventListener("click", () => {
    state.music = !state.music;
    if (!state.music) window.DrawEffects.stopDraw();
    else if (drawStartedAt !== null) window.DrawEffects.beginDraw(drawDuration, performance.now() - drawStartedAt, activeDrawTrack);
    else window.DrawEffects.primeSound();
    void persistPreferences({ music: state.music });
    renderSound();
  });

  function renderScreen() {
    const fullscreen = Boolean(document.fullscreenElement);
    screenButton.setAttribute("aria-pressed", String(fullscreen));
    screenButton.title = fullscreen ? "退出全屏" : "进入全屏";
  }

  screenButton.addEventListener("click", async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch {
      screenButton.title = "当前窗口无法全屏，可用浏览器的全屏功能";
    }
  });
  document.addEventListener("fullscreenchange", renderScreen);

  drawButton.addEventListener("click", handleNext);
  renderRound();
  renderSound();
  void fileBackup.init();
})();
