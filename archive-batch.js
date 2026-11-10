(() => {
  "use strict";

  const format = "lucky-card-stage.winners";
  const version = 1;
  const seatCount = 10;
  const maxBackupBytes = 16 * 1024 * 1024;
  const maxNameLength = 4096;
  const databaseName = "lucky-card-stage.backup";
  const storeName = "handles";
  const handleKey = "winner-archive";
  const permissionOptions = { mode: "readwrite" };

  class ArchiveError extends Error {}

  function normalize(record) {
    if (!record || !Number.isSafeInteger(record.round) || record.round < 1 ||
        !Number.isInteger(record.seat) || record.seat < 0 || record.seat >= seatCount ||
        typeof record.name !== "string" || !record.name.trim()) return null;

    const { round, seat, name, id, timestamp, participants } = record;
    const clean = { round, seat, name };
    if (id != null) {
      if (typeof id !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(id)) return null;
      clean.id = id;
    }
    if (timestamp != null) {
      const isoDateTime = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/u;
      if (!Number.isSafeInteger(timestamp) &&
          (typeof timestamp !== "string" || !isoDateTime.test(timestamp))) return null;
      const date = new Date(timestamp);
      if (Number.isNaN(date.getTime()) || date.getUTCFullYear() < 1 || date.getUTCFullYear() > 9999) return null;
      clean.timestamp = date.toISOString();
    }
    if (Array.isArray(participants) && participants.length === seatCount && participants[seat] === name) {
      const roster = [...participants];
      if (roster.every((participant) => typeof participant === "string" && participant.trim())) {
        clean.participants = roster;
      }
    }
    return clean;
  }

  const legacyKey = ({ round, seat, name }) => JSON.stringify([round, seat, name]);

  function conflicts(prior, record) {
    return legacyKey(prior) !== legacyKey(record) ||
      (prior.timestamp && record.timestamp && prior.timestamp !== record.timestamp) ||
      (prior.participants && record.participants &&
        prior.participants.some((name, seat) => name !== record.participants[seat]));
  }

  function fillMissing(prior, record) {
    if (!prior) return record;
    if (conflicts(prior, record)) return prior;
    const merged = { ...prior };
    if (!prior.timestamp && record.timestamp) merged.timestamp = record.timestamp;
    if (!prior.participants && record.participants) merged.participants = record.participants;
    return merged;
  }

  function ensureConsistentIds(records) {
    const seen = new Map();
    for (const record of records) {
      if (!record.id) continue;
      const prior = seen.get(record.id);
      if (prior && conflicts(prior, record)) {
        throw new ArchiveError("同一中奖记录编号对应了不同内容，无法合并备份。");
      }
      seen.set(record.id, fillMissing(prior, record));
    }
  }

  function merge(...recordArrays) {
    const identified = new Map();
    const legacy = new Map();
    for (const records of recordArrays) {
      if (!Array.isArray(records)) continue;
      for (const record of records) {
        const clean = normalize(record);
        if (!clean) continue;
        if (clean.id) {
          identified.set(clean.id, fillMissing(identified.get(clean.id), clean));
        } else {
          const key = legacyKey(clean);
          if (!legacy.has(key)) legacy.set(key, new Map());
          const byTime = legacy.get(key);
          byTime.set(clean.timestamp, fillMissing(byTime.get(clean.timestamp), clean));
        }
      }
    }

    const represented = new Map();
    for (const record of identified.values()) {
      const key = legacyKey(record);
      if (!represented.has(key)) represented.set(key, new Set());
      represented.get(key).add(record.timestamp);
    }

    const result = [...identified.values()];
    for (const [key, records] of legacy) {
      const timestamps = represented.get(key);
      for (const record of records.values()) {
        if (timestamps && (!record.timestamp || timestamps.has(record.timestamp))) continue;
        if (!record.timestamp && records.size > 1) continue;
        result.push(record);
      }
    }

    return result.sort((a, b) => a.round - b.round ||
      (a.timestamp || "").localeCompare(b.timestamp || "") ||
      a.seat - b.seat || a.name.localeCompare(b.name) || (a.id || "").localeCompare(b.id || ""));
  }

  function ensureBounded(text) {
    if (text.length > maxBackupBytes || new TextEncoder().encode(text).length > maxBackupBytes) {
      throw new ArchiveError("备份文件超过 16 MB。");
    }
  }

  function checkedRecords(records) {
    if (!Array.isArray(records)) throw new ArchiveError("备份缺少中奖记录列表。");
    const normalized = Array.from(records, (record, index) => {
      const clean = normalize(record);
      if (!clean) throw new ArchiveError(`第 ${index + 1} 条中奖记录格式有误。`);
      return clean;
    });
    ensureConsistentIds(normalized);
    return merge(normalized);
  }

  function serialize(records) {
    const text = JSON.stringify({ format, version, records: checkedRecords(records) }, null, 2) + "\n";
    ensureBounded(text);
    return text;
  }

  function parse(text) {
    if (typeof text !== "string") throw new ArchiveError("请选择中奖记录 JSON 备份文件。");
    ensureBounded(text);
    let value;
    try {
      value = JSON.parse(text.replace(/^\uFEFF/u, ""));
    } catch {
      throw new ArchiveError("文件内容无法读取为 JSON，请选择中奖记录备份。");
    }
    if (value?.format !== format || value.version !== version) {
      throw new ArchiveError("此文件不是本工具支持的中奖记录备份。");
    }
    return checkedRecords(value.records);
  }

  function csvCell(value) {
    let text = String(value);
    if (/^\p{Cc}|^[\s\p{Cc}\p{Cf}]*[=+\-@＝＋－＠]/u.test(text)) text = "'" + text;
    return '"' + text.replace(/"/g, '""') + '"';
  }

  function csv(records) {
    const headers = ["轮次", "中奖号码", "中奖人", "开奖时间",
      ...Array.from({ length: seatCount }, (_, seat) => `参与人${seat + 1}`)];
    const rows = merge(records).map(({ round, seat, name, timestamp, participants }) => {
      const names = participants ?? Array(seatCount).fill("");
      return [round, seat + 1, name, timestamp || "", ...names].map(csvCell).join(",");
    });
    return "\uFEFF" + [headers.join(","), ...rows].join("\r\n") + "\r\n";
  }

  function download(filename, contents, type = "application/octet-stream") {
    const url = URL.createObjectURL(new Blob([contents], { type }));
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.append(link);
    try {
      link.click();
    } finally {
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
  }

  function createFileBackup({ getRecords, mergeRecords, onStatus = () => {} }) {
    let storage;
    try {
      storage = window.indexedDB;
    } catch {
      // Storage can be blocked in private or embedded contexts.
    }
    const supported = typeof window.showSaveFilePicker === "function" && Boolean(storage);
    let handle;
    let queue = Promise.resolve();

    function report(code, message) {
      onStatus(code, message);
    }

    function enqueue(operation) {
      const result = queue.then(operation).catch((error) => {
        report("error", error instanceof ArchiveError ? error.message : "无法保存自动备份，请重新选择备份文件。");
        return false;
      });
      queue = result;
      return result;
    }

    async function handleStore(mode, operation) {
      const database = await new Promise((resolve, reject) => {
        const request = storage.open(databaseName, 1);
        request.onupgradeneeded = () => request.result.createObjectStore(storeName);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      try {
        return await new Promise((resolve, reject) => {
          const transaction = database.transaction(storeName, mode);
          const request = operation(transaction.objectStore(storeName));
          transaction.oncomplete = () => resolve(request.result);
          transaction.onabort = () => reject(transaction.error || request.error);
        });
      } finally {
        database.close();
      }
    }

    async function saveTo(target) {
      if (await target.queryPermission(permissionOptions) !== "granted") {
        report("permission-needed");
        return false;
      }
      report("saving");
      const writeLatest = async () => {
        const file = await target.getFile();
        if (file.size > maxBackupBytes) throw new ArchiveError("选中的备份文件超过 16 MB，未改动原文件。");
        const original = file.size ? await file.text() : "";
        const existing = original ? parse(original) : [];
        const current = merge(getRecords());
        ensureConsistentIds([...current, ...existing]);
        const combined = merge(current, existing);
        if (JSON.stringify(combined) !== JSON.stringify(current) && mergeRecords) await mergeRecords(existing);
        const contents = serialize(merge(combined, getRecords()));
        if (contents === original) return true;
        const writer = await target.createWritable({ mode: "exclusive" });
        try {
          await writer.write(contents);
          await writer.close();
        } catch (error) {
          try {
            await writer.abort();
          } catch {
            // The writer may already have aborted.
          }
          throw error;
        }
        return true;
      };
      const locks = window.navigator?.locks;
      return locks ? locks.request(databaseName, writeLatest) : writeLatest();
    }

    async function syncBound() {
      if (!handle || !await saveTo(handle)) return false;
      report("synced");
      return true;
    }

    function init() {
      if (!supported) {
        report("unsupported");
        return Promise.resolve(false);
      }
      return enqueue(async () => {
        handle ??= await handleStore("readonly", (store) => store.get(handleKey));
        if (!handle) {
          report("unbound");
          return false;
        }
        return syncBound();
      });
    }

    async function bind() {
      if (!supported) return false;
      let target;
      try {
        target = await window.showSaveFilePicker({
          suggestedName: "中奖记录备份.json",
          types: [{ description: "中奖记录 JSON 备份", accept: { "application/json": [".json"] } }],
          excludeAcceptAllOption: true,
        });
      } catch (error) {
        if (error?.name !== "AbortError") report("error", "无法选择备份文件，请在支持的浏览器中重试。");
        return false;
      }

      return enqueue(async () => {
        if (!await saveTo(target)) return false;
        await handleStore("readwrite", (store) => store.put(target, handleKey));
        handle = target;
        report("synced");
        return true;
      });
    }

    function sync() {
      return supported ? enqueue(syncBound) : Promise.resolve(false);
    }

    async function reconnect() {
      if (!supported) return false;
      if (!handle) return bind();
      try {
        if (await handle.requestPermission(permissionOptions) === "granted") return sync();
        report("permission-needed");
      } catch {
        report("permission-needed");
      }
      return false;
    }

    return { init, bind, sync, reconnect, supported };
  }

  window.DrawArchive = { merge, csv, serialize, parse, download, createFileBackup, maxBackupBytes, maxNameLength };
})();
