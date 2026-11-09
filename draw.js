(() => {
  "use strict";

  const seatCount = 10;
  const drawDuration = 9000;
  const drawPhases = [
    { key: "warmup", label: "抽选启动", caption: "抽选启动 / STARTING", intervals: [460, 390, 325, 275, 225, 175] },
    { key: "rush", label: "高速抽选", caption: "高速抽选 / IN MOTION", intervals: Array(36).fill(88) },
    { key: "slow", label: "即将锁定", caption: "即将锁定 / SLOWING DOWN", intervals: [130, 155, 190, 230, 280, 350, 445, 545, 720] },
  ];
  const storageKey = "lucky-card-stage.v1";
  const formatNumber = (number) => String(number).padStart(2, "0");
  const sampleNames = Array.from({ length: seatCount }, (_, index) => `星宸 ${formatNumber(index + 1)}`);
  const legacySampleName = (seat) => `选手 ${formatNumber(seat + 1)}`;
  const initialState = () => ({ round: 1, roster: [...sampleNames], results: [], music: true });
  const get = (id) => document.getElementById(id);
  const motion = matchMedia("(prefers-reduced-motion: reduce)");
  let state = load();
  let drawStartedAt = null;

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
  const screenButton = get("toggle-screen");
  const rosterDialog = get("roster-dialog");
  const historyDialog = get("history-dialog");
  const winnerDialog = get("winner-dialog");
  const namesInput = get("names-input");
  const rosterCount = get("roster-count");
  const rosterError = get("roster-error");
  const saveRoster = get("save-roster");

  function load() {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey));
      if (saved && Number.isSafeInteger(saved.round) && saved.round > 0 &&
          Array.isArray(saved.roster) && saved.roster.length === seatCount &&
          saved.roster.every((name) => typeof name === "string" && name.trim()) &&
          Array.isArray(saved.results)) {
        if (saved.roster.every((name, seat) => name === legacySampleName(seat))) {
          saved.roster = [...sampleNames];
          saved.results = saved.results.map((result) =>
            result.name === legacySampleName(result.seat) && sampleNames[result.seat]
              ? { ...result, name: sampleNames[result.seat] }
              : result
          );
        }
        if (typeof saved.music !== "boolean") saved.music = true;
        return saved;
      }
    } catch {
      // Storage may be unavailable in a restricted browser.
    }
    return initialState();
  }

  function persist() {
    try {
      localStorage.setItem(storageKey, JSON.stringify(state));
    } catch {
      document.querySelector(".foot span:last-child").textContent = "名单与记录仅在此页面保留";
    }
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

  function currentResult() {
    const last = state.results.at(-1);
    return last?.round === state.round ? last : null;
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

  function renderRound() {
    get("round-number").textContent = formatNumber(state.round);
    const cards = state.roster.map((name, index) => {
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

    const result = currentResult();
    if (result) {
      renderWinner(result);
      return;
    }

    stage.classList.remove("is-won");
    showSignal("等待开奖", "READY TO DRAW", "待命");
    rosterButton.disabled = false;
    historyButton.disabled = false;
    drawButton.disabled = false;
    get("draw-label").textContent = "开始点名";
    const usingSamples = state.roster.every((name, index) => name === sampleNames[index]);
    setStatus("准备就绪", usingSamples ? "正在使用示例名单，可替换为现场名单。" : "名单已就绪，点击开始揭晓。");
  }

  function renderWinner(result, { reveal = false } = {}) {
    const winnerCard = deck.children[result.seat];
    const details = `第 ${formatNumber(result.round)} 轮 · ${formatNumber(result.seat + 1)} 号`;
    stage.classList.remove("is-drawing");
    delete stage.dataset.phase;
    stage.classList.add("is-won");
    winnerCard.classList.add("is-winner");
    winnerCard.setAttribute("aria-label", `${formatNumber(result.seat + 1)} 号 ${result.name}，本轮中奖`);
    showSignal(result.name, "宸团来道贺！", "已揭晓", result.seat);
    setStatus(`恭喜 ${result.name}！`, details, "trophy");
    drawButton.disabled = false;
    rosterButton.disabled = true;
    historyButton.disabled = false;
    get("draw-label").textContent = "进入下一轮";

    if (!reveal) return;
    if (typeof winnerDialog?.showModal === "function") {
      const winnerName = get("winner-name");
      winnerName.textContent = result.name;
      get("winner-meta").textContent = details;
      winnerDialog.showModal();
      window.DrawEffects.celebrate(get("winner-confetti"), { sound: state.music, origin: winnerName });
    } else {
      window.DrawEffects.celebrate(get("confetti"), { sound: state.music, origin: signalName });
    }
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

  async function rollNames(start) {
    const cards = Array.from(deck.children);
    let active = randomIndex(seatCount);
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
          showSignal(state.roster[active], phase.caption, phase.label, active);
          cards[active].classList.add("is-active");
          await waitUntil(deadline);
          cards[active].classList.remove("is-active");
        }
        active = (active + 1) % seatCount;
      }
    }

    stage.dataset.phase = "hold";
    showSignal("即将揭晓", "结果已锁定 / LOCKED", "已锁定");
    await waitUntil(start + drawDuration);
  }

  async function draw() {
    if (drawStartedAt !== null) return;
    if (currentResult()) {
      advanceRound();
      return;
    }

    drawStartedAt = performance.now();
    stage.style.setProperty("--draw-duration", `${drawDuration}ms`);
    stage.classList.add("is-drawing");
    drawButton.disabled = true;
    rosterButton.disabled = true;
    historyButton.disabled = true;
    get("draw-label").textContent = "抽选中";
    if (state.music) window.DrawEffects.beginDraw(drawDuration);

    const seat = randomIndex(seatCount);
    const result = { round: state.round, seat, name: state.roster[seat] };
    state.results.push(result);
    persist();

    setStatus("抽选进行中", "本轮将在约 9 秒后揭晓。");
    await rollNames(drawStartedAt);
    drawStartedAt = null;
    renderWinner(result, { reveal: true });
  }

  function advanceRound() {
    state.round += 1;
    persist();
    renderRound();
  }

  function enteredNames() {
    return namesInput.value.split(/\r?\n/).map((name) => name.trim()).filter(Boolean);
  }

  function updateRosterCount() {
    const count = enteredNames().length;
    rosterCount.textContent = `${count} / ${seatCount}`;
    rosterError.textContent = count > seatCount ? "本轮需要 10 位参与者，请删去多余的姓名。" : "";
    rosterError.hidden = count <= seatCount;
    namesInput.setAttribute("aria-invalid", String(count > seatCount));
    saveRoster.disabled = count !== seatCount;
  }

  rosterButton.addEventListener("click", () => {
    namesInput.value = state.roster.join("\n");
    updateRosterCount();
    rosterDialog.showModal();
  });

  namesInput.addEventListener("input", updateRosterCount);
  get("demo-names").addEventListener("click", () => {
    namesInput.value = sampleNames.join("\n");
    updateRosterCount();
    namesInput.focus();
  });
  get("roster-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const names = enteredNames();
    if (drawStartedAt !== null || currentResult() || names.length !== seatCount) return;
    state.roster = names;
    persist();
    renderRound();
    rosterDialog.close();
  });

  historyButton.addEventListener("click", () => {
    const rows = [...state.results].reverse().map((result) => {
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
      return row;
    });
    get("history-list").replaceChildren(...rows);
    get("history-empty").hidden = rows.length > 0;
    historyDialog.showModal();
  });

  document.querySelectorAll("[data-close-dialog]").forEach((button) => {
    button.addEventListener("click", () => get(button.dataset.closeDialog).close());
  });

  get("winner-next")?.addEventListener("click", () => {
    if (!winnerDialog.open || !currentResult()) return;
    winnerDialog.close();
    advanceRound();
  });
  winnerDialog?.addEventListener("close", () => drawButton.focus({ preventScroll: true }));

  function renderSound() {
    soundButton.setAttribute("aria-pressed", String(state.music));
    soundButton.title = state.music ? "关闭音乐" : "开启音乐";
    soundButton.replaceChildren(icon(state.music ? "sound" : "muted"));
  }

  soundButton.addEventListener("click", () => {
    state.music = !state.music;
    if (!state.music) window.DrawEffects.stopDraw();
    else if (drawStartedAt !== null) window.DrawEffects.beginDraw(drawDuration, performance.now() - drawStartedAt);
    else window.DrawEffects.primeSound();
    persist();
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

  drawButton.addEventListener("click", draw);
  renderRound();
  renderSound();
})();
