(() => {
  "use strict";

  const numberedPrefix = /^(?:[(（]\s*[0-9０-９]+\s*[)）]|[0-9０-９]+\s*[.．。｡、)）])/u;

  function parse(text) {
    if (typeof text !== "string") return [];
    return text.split(/\r\n|[\r\n\u2028\u2029]/u)
      .map((line) => line.trim().replace(numberedPrefix, "").trim())
      .filter(Boolean);
  }

  function groups(names, seatCount = 10) {
    if (!Array.isArray(names) || !Number.isSafeInteger(seatCount) || seatCount < 1) return [];
    const result = [];
    for (let index = 0; index < names.length; index += seatCount) {
      result.push(names.slice(index, index + seatCount));
    }
    return result;
  }

  function validBatch(batch, seatCount = 10) {
    if (!Number.isSafeInteger(seatCount) || seatCount < 1 || !Array.isArray(batch?.groups) ||
        !Number.isInteger(batch.index) || batch.index < 0 || batch.index >= batch.groups.length) return false;

    for (const group of batch.groups) {
      if (!Array.isArray(group) || group.length !== seatCount) return false;
      for (const name of group) {
        if (typeof name !== "string" || !name.trim()) return false;
      }
    }
    return true;
  }

  window.DrawRoster = { parse, groups, validBatch };
})();
