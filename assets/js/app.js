/* =========================================================
   PDF → TXT — client-side converter
   Powered by PDF.js & JSZip
   ========================================================= */
(() => {
  "use strict";

  const pdfjsLib = window.pdfjsLib;
  if (pdfjsLib) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = "vendor/pdf.worker.min.js";
  }

  const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100 MB (peringatan saja)
  const PREVIEW_LIMIT = 12000;

  /* ---------------- DOM ---------------- */
  const $ = (id) => document.getElementById(id);

  const dropzone = $("dropzone");
  const fileInput = $("file-input");
  const workspace = $("workspace");
  const fileList = $("file-list");
  const fileCount = $("file-count");
  const clearBtn = $("clear-files");
  const convertBtn = $("convert-btn");
  const actionSummary = $("action-summary");
  const progressWrap = $("progress-wrap");
  const progressBar = $("progress-bar");
  const progressText = $("progress-text");

  const pageRangeInput = $("page-range");
  const pageMarkerSelect = $("page-marker");
  const customMarkerWrap = $("custom-marker-wrap");
  const customMarkerInput = $("custom-marker");
  const textModeSelect = $("text-mode");
  const encodingSelect = $("output-encoding");
  const removeEmptyCheck = $("remove-empty");
  const joinHyphenCheck = $("join-hyphen");

  const resultsPanel = $("results-panel");
  const resultsList = $("results-list");
  const downloadAllBtn = $("download-all");
  const downloadCombinedBtn = $("download-combined");
  const toastEl = $("toast");

  const passwordModal = $("password-modal");
  const pwForm = $("pw-form");
  const pwInput = $("pw-input");
  const pwError = $("pw-error");
  const pwMsg = $("pw-msg");
  const pwFilename = $("pw-filename");
  const pwCancel = $("pw-cancel");

  /* ---------------- State ---------------- */
  /** @type {Array<{id:string,file:File,name:string,size:number,status:'ready'|'working'|'done'|'error',text?:string,error?:string,pages?:number,pageCount?:number,scanned?:boolean,truncated?:boolean}>} */
  let files = [];
  let isConverting = false;
  let idSeq = 0;

  /* ---------------- Helpers ---------------- */
  function formatBytes(bytes) {
    if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
    const units = ["B", "KB", "MB", "GB"];
    const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    const value = bytes / Math.pow(1024, i);
    return `${value.toFixed(i === 0 ? 0 : value >= 10 ? 0 : 1)} ${units[i]}`;
  }

  function sanitizeName(name) {
    return name
      .replace(/\.pdf$/i, "")
      .replace(/[\\/:*?"<>|]+/g, "-")
      .replace(/\s+/g, " ")
      .trim() || "dokumen";
  }

  function wordCount(text) {
    const m = text.match(/\S+/g);
    return m ? m.length : 0;
  }

  let toastTimer = null;
  function toast(message, type = "info") {
    toastEl.textContent = message;
    toastEl.className = "toast show" + (type === "error" ? " is-error" : type === "success" ? " is-success" : "");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toastEl.className = "toast";
    }, 3200);
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  function textBlob(text) {
    const bom = encodingSelect.value === "utf8-bom" ? "\uFEFF" : "";
    return new Blob([bom + text], { type: "text/plain;charset=utf-8" });
  }

  function downloadText(text, filename) {
    downloadBlob(textBlob(text), filename);
  }

  /* ---------------- Password modal ---------------- */
  let passwordResolver = null;

  function askPassword(filename, isRetry) {
    return new Promise((resolve) => {
      if (passwordResolver) passwordResolver(null);
      passwordResolver = resolve;

      pwFilename.textContent = filename;
      pwFilename.title = filename;
      pwError.hidden = !isRetry;
      if (isRetry) pwError.textContent = "Kata sandi salah. Silakan coba lagi.";
      pwMsg.textContent = isRetry
        ? "Kata sandi yang Anda masukkan salah. Silakan coba lagi."
        : "File ini memerlukan kata sandi untuk dibuka dan dikonversi.";
      pwInput.value = "";
      passwordModal.hidden = false;
      document.body.classList.add("modal-open");
      pwInput.focus();
    });
  }

  function closePasswordModal(value) {
    if (!passwordResolver) return;
    const resolve = passwordResolver;
    passwordResolver = null;
    passwordModal.hidden = true;
    document.body.classList.remove("modal-open");
    resolve(value);
  }

  /* ---------------- Add / remove files ---------------- */
  function isPdf(file) {
    return /\.pdf$/i.test(file.name) || file.type === "application/pdf";
  }

  function addFiles(list) {
    const incoming = Array.from(list || []);
    if (!incoming.length) return;

    const rejected = [];
    const tooBig = [];
    let added = 0;

    for (const file of incoming) {
      if (!isPdf(file)) {
        rejected.push(file.name);
        continue;
      }
      const duplicate = files.some(
        (f) => f.name === file.name && f.size === file.size && f.file.lastModified === file.lastModified
      );
      if (duplicate) continue;

      files.push({
        id: `f${++idSeq}`,
        file,
        name: file.name,
        size: file.size,
        status: "ready",
      });
      added++;
      if (file.size > MAX_FILE_SIZE) tooBig.push(file.name);
    }

    if (rejected.length) {
      toast(
        rejected.length === 1
          ? `"${rejected[0]}" bukan file PDF.`
          : `${rejected.length} file diabaikan karena bukan PDF.`,
        "error"
      );
    }
    if (tooBig.length) {
      toast(`File besar (> ${formatBytes(MAX_FILE_SIZE)}) tetap diproses, mungkin lebih lambat.`);
    }
    if (added && !rejected.length && !tooBig.length) {
      toast(added === 1 ? "File ditambahkan." : `${added} file ditambahkan.`, "success");
    }

    render();
    if (added) {
      workspace.hidden = false;
      requestAnimationFrame(() => {
        workspace.scrollIntoView({ behavior: "smooth", block: "nearest" });
      });
    }
  }

  function removeFile(id) {
    if (isConverting) return;
    files = files.filter((f) => f.id !== id);
    render();
    if (!files.length) {
      workspace.hidden = true;
      resetProgress();
    }
  }

  function clearFiles() {
    if (isConverting) return;
    files = [];
    fileInput.value = "";
    resetProgress();
    render();
    workspace.hidden = true;
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  /* ---------------- Render ---------------- */
  function render() {
    const count = files.length;
    fileCount.textContent = String(count);

    const ready = files.filter((f) => f.status === "ready").length;
    const done = files.filter((f) => f.status === "done").length;

    if (isConverting) {
      actionSummary.textContent = "Sedang memproses…";
    } else if (!count) {
      actionSummary.textContent = "0 file siap dikonversi.";
    } else if (done && !ready) {
      actionSummary.textContent = `${done} file selesai dikonversi.`;
    } else {
      actionSummary.textContent = `${count} file • ${formatBytes(files.reduce((s, f) => s + f.size, 0))}`;
    }

    convertBtn.disabled = isConverting || count === 0;
    convertBtn.classList.toggle("is-working", isConverting);
    convertBtn.querySelector("span").textContent = isConverting
      ? "Mengonversi…"
      : done && !ready
        ? "Konversi ulang"
        : "Konversi ke TXT";

    renderFileList();
    renderResults();
  }

  function statusInfo(f) {
    switch (f.status) {
      case "working":
        return { cls: "is-working", label: "Memproses…" };
      case "done":
        return {
          cls: "is-done",
          label: f.scanned ? "Tidak ada teks" : `Selesai • ${f.pageCount || 0} hal.`,
        };
      case "error":
        return { cls: "is-error", label: "Gagal" };
      default:
        return { cls: "", label: "Siap" };
    }
  }

  function renderFileList() {
    fileList.textContent = "";
    const frag = document.createDocumentFragment();

    for (const f of files) {
      const li = document.createElement("li");
      li.className = "file-item";
      li.dataset.id = f.id;

      const icon = document.createElement("span");
      icon.className = "file-icon";
      icon.textContent = "PDF";
      icon.setAttribute("aria-hidden", "true");

      const meta = document.createElement("span");
      meta.className = "file-meta";

      const name = document.createElement("span");
      name.className = "file-name";
      name.textContent = f.name;
      name.title = f.name;

      const sub = document.createElement("span");
      sub.className = "file-sub";

      const size = document.createElement("span");
      size.textContent = formatBytes(f.size);

      const dot = document.createElement("span");
      dot.className = "dot";
      dot.setAttribute("aria-hidden", "true");

      const status = document.createElement("span");
      const info = statusInfo(f);
      status.className = `status ${info.cls}`.trim();
      status.textContent = info.label;

      sub.append(size, dot, status);
      meta.append(name, sub);

      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "remove-file";
      remove.title = `Hapus ${f.name}`;
      remove.setAttribute("aria-label", `Hapus ${f.name}`);
      remove.disabled = isConverting;
      remove.innerHTML =
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>';
      remove.addEventListener("click", () => removeFile(f.id));

      li.append(icon, meta, remove);
      frag.appendChild(li);
    }

    fileList.appendChild(frag);
    clearBtn.disabled = isConverting;
  }

  function renderResults() {
    const done = files.filter((f) => f.status === "done");
    const failed = files.filter((f) => f.status === "error");

    if (!done.length && !failed.length) {
      resultsPanel.hidden = true;
      resultsList.textContent = "";
      return;
    }

    resultsPanel.hidden = false;
    downloadAllBtn.disabled = !done.length;
    downloadCombinedBtn.disabled = done.length < 1;

    resultsList.textContent = "";
    const frag = document.createDocumentFragment();

    for (const f of done) {
      frag.appendChild(buildResultCard(f));
    }
    for (const f of failed) {
      frag.appendChild(buildErrorCard(f));
    }
    resultsList.appendChild(frag);
  }

  function buildResultCard(f) {
    const card = document.createElement("article");
    card.className = "result-card";

    const top = document.createElement("div");
    top.className = "result-top";

    const title = document.createElement("div");
    title.className = "result-title";
    const strong = document.createElement("strong");
    strong.textContent = f.name;
    strong.title = f.name;
    const stats = document.createElement("span");
    stats.className = "result-stats";
    const text = f.text || "";
    stats.textContent = `${wordCount(text).toLocaleString("id-ID")} kata • ${text.length.toLocaleString("id-ID")} karakter • ${f.pageCount || 0} halaman`;
    title.append(strong, stats);

    const buttons = document.createElement("div");
    buttons.className = "result-buttons";

    const copyBtn = document.createElement("button");
    copyBtn.type = "button";
    copyBtn.className = "btn-mini";
    copyBtn.innerHTML =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg><span>Salin</span>';
    copyBtn.addEventListener("click", async () => {
      const ok = await copyText(text);
      toast(ok ? "Teks disalin ke papan klip." : "Gagal menyalin teks.", ok ? "success" : "error");
    });

    const dlBtn = document.createElement("button");
    dlBtn.type = "button";
    dlBtn.className = "btn-mini";
    dlBtn.innerHTML =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/></svg><span>TXT</span>';
    dlBtn.addEventListener("click", () => {
      downloadText(text, `${sanitizeName(f.name)}.txt`);
      toast("File TXT diunduh.", "success");
    });

    buttons.append(copyBtn, dlBtn);
    top.append(title, buttons);

    const pre = document.createElement("pre");
    pre.className = "result-preview";
    pre.tabIndex = 0;
    pre.setAttribute("aria-label", `Pratinjau teks ${f.name}`);
    const shown = text.length > PREVIEW_LIMIT ? text.slice(0, PREVIEW_LIMIT) : text;
    pre.textContent = shown || "(tidak ada teks yang terekstrak)";

    card.append(top, pre);

    if (text.length > PREVIEW_LIMIT) {
      const note = document.createElement("div");
      note.className = "result-note";
      note.textContent = `Pratinjau dipotong. File lengkap berisi ${text.length.toLocaleString("id-ID")} karakter — unduh TXT untuk melihat semuanya.`;
      card.appendChild(note);
    }

    if (f.scanned || !text.trim()) {
      const note = document.createElement("div");
      note.className = "result-note";
      note.textContent =
        "Tidak ada teks terdeteksi. PDF ini kemungkinan hasil pindaian (gambar) dan memerlukan OCR.";
      card.appendChild(note);
    }

    return card;
  }

  function buildErrorCard(f) {
    const card = document.createElement("article");
    card.className = "result-card";

    const top = document.createElement("div");
    top.className = "result-top";
    const title = document.createElement("div");
    title.className = "result-title";
    const strong = document.createElement("strong");
    strong.textContent = f.name;
    const stats = document.createElement("span");
    stats.className = "result-stats";
    stats.textContent = "Konversi gagal";
    title.append(strong, stats);
    top.appendChild(title);

    const err = document.createElement("div");
    err.className = "result-error";
    err.textContent = f.error || "Terjadi kesalahan yang tidak diketahui.";

    card.append(top, err);
    return card;
  }

  async function copyText(text) {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch (_) {
      /* fallback di bawah */
    }
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      return ok;
    } catch (_) {
      return false;
    }
  }

  /* ---------------- Options ---------------- */
  function getOptions() {
    let marker = pageMarkerSelect.value;
    if (marker === "__custom") marker = customMarkerInput.value.trim() || "--- Halaman {n} ---";
    return {
      range: pageRangeInput.value.trim(),
      marker,
      layout: textModeSelect.value === "layout",
      removeEmptyLines: removeEmptyCheck.checked,
      joinHyphen: joinHyphenCheck.checked,
    };
  }

  function parsePageRange(input, total) {
    if (!input) return Array.from({ length: total }, (_, i) => i + 1);

    const pages = new Set();
    const parts = input.split(/[,;]/);

    for (const raw of parts) {
      const part = raw.trim();
      if (!part) continue;

      let m = part.match(/^(\d+)\s*[-–]\s*(\d+)$/);
      if (m) {
        let start = Number(m[1]);
        let end = Number(m[2]);
        if (start > end) [start, end] = [end, start];
        for (let p = start; p <= end; p++) {
          if (p >= 1 && p <= total) pages.add(p);
        }
        continue;
      }

      m = part.match(/^(\d+)\s*[-–]$/);
      if (m) {
        const start = Number(m[1]);
        for (let p = start; p <= total; p++) if (p >= 1) pages.add(p);
        continue;
      }

      m = part.match(/^(\d+)$/);
      if (m) {
        const p = Number(m[1]);
        if (p >= 1 && p <= total) pages.add(p);
        else if (p > total) throw new Error(`Halaman ${p} melebihi jumlah halaman PDF (${total}).`);
        continue;
      }

      throw new Error(`Format halaman "${part}" tidak valid. Gunakan contoh: 1-3, 5.`);
    }

    if (!pages.size) {
      throw new Error(`Tidak ada halaman yang cocok. PDF ini memiliki ${total} halaman.`);
    }
    return Array.from(pages).sort((a, b) => a - b);
  }

  /* ---------------- Text extraction ---------------- */
  function textItemsToText(items, options) {
    const rows = [];

    for (const item of items) {
      if (typeof item.str !== "string" || !item.str || !item.transform) continue;
      if (item.type) continue; // marked-content marker

      const x = item.transform[4];
      const y = item.transform[5];
      const size = Math.abs(item.transform[3]) || Math.abs(item.height) || 10;
      const tolerance = Math.max(1.5, size * 0.32);

      let row = null;
      for (let i = rows.length - 1; i >= 0 && i >= rows.length - 24; i--) {
        if (Math.abs(rows[i].y - y) <= tolerance) {
          row = rows[i];
          break;
        }
      }
      if (!row) {
        row = { y, size, items: [] };
        rows.push(row);
      }
      row.items.push({ x, str: item.str, width: Math.abs(item.width) || 0, size });
    }

    rows.sort((a, b) => b.y - a.y);

    const lines = [];
    for (const row of rows) {
      row.items.sort((a, b) => a.x - b.x);
      let line = "";
      let prevEnd = null;

      for (const item of row.items) {
        if (prevEnd !== null) {
          const gap = item.x - prevEnd;
          if (options.layout) {
            const charWidth = item.str.length > 0 ? item.width / item.str.length : item.size * 0.5;
            const spaces = Math.floor(gap / Math.max(0.5, charWidth));
            if (spaces > 0) line += " ".repeat(Math.min(spaces, 80));
          } else if (gap > Math.max(1.2, Math.min(item.size, row.size) * 0.18)) {
            if (!/\s$/.test(line) && !/^\s/.test(item.str)) line += " ";
          }
        }
        line += item.str;
        prevEnd = item.x + item.width;
      }

      line = options.layout ? line.replace(/[ \t]+$/g, "") : line.replace(/\s+/g, " ").trim();

      if (options.joinHyphen && lines.length) {
        const prev = lines[lines.length - 1];
        if (/[A-Za-zÀ-ÿ]-$/.test(prev) && /^[a-zà-ÿ]/.test(line)) {
          lines[lines.length - 1] = prev.slice(0, -1) + line;
          continue;
        }
      }

      if (!options.removeEmptyLines || line.trim()) {
        lines.push(line);
      }
    }

    // Rapikan baris kosong berlebih di awal/akhir halaman
    while (lines.length && !lines[0].trim()) lines.shift();
    while (lines.length && !lines[lines.length - 1].trim()) lines.pop();

    return lines.join("\n");
  }

  function buildPageHeader(marker, pageNumber) {
    if (!marker) return "";
    return marker.replace(/\{n\}/g, String(pageNumber));
  }

  async function extractPdf(file, options, onProgress) {
    const buffer = await file.arrayBuffer();

    const loadingTask = pdfjsLib.getDocument({
      data: new Uint8Array(buffer),
      isEvalSupported: false,
      useSystemFonts: true,
    });

    let passwordCancelled = false;
    loadingTask.onPassword = async (updatePassword, reason) => {
      const isRetry = reason === pdfjsLib.PasswordResponses.INCORRECT_PASSWORD;
      const password = await askPassword(file.name, isRetry);
      if (password === null) {
        passwordCancelled = true;
        loadingTask.destroy();
        return;
      }
      updatePassword(password);
    };

    let pdf;
    try {
      pdf = await loadingTask.promise;
    } catch (err) {
      if (passwordCancelled) throw new Error("Dibatalkan: PDF memerlukan kata sandi.");
      throw err;
    }

    try {
      const pageNumbers = parsePageRange(options.range, pdf.numPages);
      const parts = [];

      for (let i = 0; i < pageNumbers.length; i++) {
        const pageNumber = pageNumbers[i];
        const page = await pdf.getPage(pageNumber);
        const content = await page.getTextContent({ includeMarkedContent: false });
        const text = textItemsToText(content.items, options);
        const header = buildPageHeader(options.marker, pageNumber);
        parts.push(header ? `${header}\n${text}` : text);

        if (typeof onProgress === "function") {
          onProgress(i + 1, pageNumbers.length, pageNumber);
        }

        page.cleanup();
        // Beri kesempatan UI bernapas pada dokumen besar
        await new Promise((resolve) => setTimeout(resolve, 0));
      }

      const joined = parts.join("\n\n").replace(/\n{4,}/g, "\n\n\n").trim();
      return {
        text: joined,
        pageCount: pageNumbers.length,
        totalPages: pdf.numPages,
        scanned: joined.length === 0,
      };
    } finally {
      await pdf.destroy();
    }
  }

  /* ---------------- Convert ---------------- */
  async function convertAll() {
    if (isConverting || !files.length) return;

    if (!pdfjsLib) {
      toast("Pustaka PDF.js gagal dimuat. Periksa koneksi lalu muat ulang halaman.", "error");
      return;
    }

    const options = getOptions();

    // Validasi rentang halaman lebih awal (per file, karena jumlah halaman berbeda)
    const targets = files.slice();
    isConverting = true;
    progressWrap.hidden = false;
    setProgress(0, "Menyiapkan…");
    render();

    let completed = 0;

    for (const f of targets) {
      f.status = "working";
      f.error = undefined;
      f.text = undefined;
      render();

      try {
        const result = await extractPdf(f.file, options, (donePages, totalPages) => {
          const fileFraction = donePages / totalPages;
          const overall = (completed + fileFraction) / targets.length;
          setProgress(overall * 100, `${f.name} — halaman ${donePages}/${totalPages}`);
        });

        f.text = result.text;
        f.pageCount = result.pageCount;
        f.totalPages = result.totalPages;
        f.scanned = result.scanned;
        f.status = "done";
      } catch (err) {
        console.error(err);
        f.status = "error";
        f.error = friendlyError(err);
      }

      completed++;
      setProgress((completed / targets.length) * 100, `${completed} dari ${targets.length} file selesai`);
      render();
    }

    isConverting = false;
    setProgress(100, "Selesai!");
    render();

    const done = files.filter((f) => f.status === "done").length;
    const failed = files.filter((f) => f.status === "error").length;

    if (done) {
      toast(
        failed
          ? `${done} file berhasil, ${failed} gagal.`
          : done === 1
            ? "Konversi selesai. Unduh file TXT Anda."
            : `${done} file berhasil dikonversi.`,
        failed ? "error" : "success"
      );
    } else if (failed) {
      toast("Semua file gagal dikonversi. Lihat detail kesalahan.", "error");
    }

    // Sembunyikan progress setelah beberapa saat
    setTimeout(() => {
      if (!isConverting) progressWrap.hidden = true;
    }, 2500);

    setTimeout(() => {
      if (!isConverting) render();
    }, 2600);
  }

  function friendlyError(err) {
    const message = String((err && err.message) || err || "");
    if (/dibatalkan/i.test(message)) return "Konversi dibatalkan karena PDF memerlukan kata sandi.";
    if (/password|kata sandi/i.test(message)) {
      return "PDF dilindungi kata sandi dan tidak dapat dibuka.";
    }
    if (/Invalid PDF|not a PDF|PDF structure/i.test(message)) {
      return "File tidak valid atau rusak. Pastikan file benar-benar PDF.";
    }
    if (/worker/i.test(message)) return "Gagal memuat pemroses PDF. Muat ulang halaman lalu coba lagi.";
    return message || "Gagal mengekstrak teks dari PDF ini.";
  }

  function setProgress(percent, label) {
    progressBar.style.width = `${Math.max(0, Math.min(100, percent))}%`;
    if (label) progressText.textContent = label;
  }

  function resetProgress() {
    setProgress(0, "Menyiapkan…");
    progressWrap.hidden = true;
  }

  /* ---------------- Download all / combined ---------------- */
  function doneFiles() {
    return files.filter((f) => f.status === "done");
  }

  async function downloadAllZip() {
    const list = doneFiles();
    if (!list.length) return;

    if (!window.JSZip) {
      toast("Pustaka ZIP gagal dimuat. Unduh file satu per satu.", "error");
      return;
    }

    downloadAllBtn.disabled = true;
    const original = downloadAllBtn.innerHTML;
    downloadAllBtn.textContent = "Membuat ZIP…";

    try {
      const zip = new JSZip();
      const usedNames = new Set();

      for (const f of list) {
        const base = sanitizeName(f.name);
        let filename = `${base}.txt`;
        let counter = 2;
        while (usedNames.has(filename.toLowerCase())) {
          filename = `${base} (${counter++}).txt`;
        }
        usedNames.add(filename.toLowerCase());
        zip.file(filename, (encodingSelect.value === "utf8-bom" ? "\uFEFF" : "") + (f.text || ""));
      }

      const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE" });
      downloadBlob(blob, `pdf-ke-txt-${new Date().toISOString().slice(0, 10)}.zip`);
      toast(`${list.length} file TXT diunduh sebagai ZIP.`, "success");
    } catch (err) {
      console.error(err);
      toast("Gagal membuat ZIP. Coba unduh file satu per satu.", "error");
    } finally {
      downloadAllBtn.innerHTML = original;
      downloadAllBtn.disabled = false;
    }
  }

  function downloadCombined() {
    const list = doneFiles();
    if (!list.length) return;

    const chunks = list.map((f) => {
      const text = (f.text || "").trim();
      if (list.length === 1) return text;
      return `===== ${f.name} =====\n\n${text}`;
    });

    const combined = chunks.join("\n\n\n");
    const name =
      list.length === 1
        ? `${sanitizeName(list[0].name)}.txt`
        : `pdf-gabungan-${new Date().toISOString().slice(0, 10)}.txt`;

    downloadText(combined, name);
    toast("File TXT gabungan diunduh.", "success");
  }

  /* ---------------- Events ---------------- */
  dropzone.addEventListener("click", () => {
    if (!isConverting) fileInput.click();
  });
  dropzone.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (!isConverting) fileInput.click();
    }
  });

  fileInput.addEventListener("change", () => {
    addFiles(fileInput.files);
    fileInput.value = "";
  });

  ["enter", "dragover"].forEach((type) => {
    dropzone.addEventListener(type, (e) => {
      e.preventDefault();
      if (!isConverting) dropzone.classList.add("dragover");
    });
  });
  ["leave", "dragleave"].forEach((type) => {
    dropzone.addEventListener(type, () => dropzone.classList.remove("dragover"));
  });
  dropzone.addEventListener("drop", (e) => {
    e.preventDefault();
    dropzone.classList.remove("dragover");
    if (!isConverting) addFiles(e.dataTransfer.files);
  });

  // Cegah browser membuka PDF saat file jatuh di luar dropzone
  window.addEventListener("dragover", (e) => {
    if (e.dataTransfer && Array.from(e.dataTransfer.types).includes("Files")) e.preventDefault();
  });
  window.addEventListener("drop", (e) => {
    if (e.dataTransfer && Array.from(e.dataTransfer.types).includes("Files")) e.preventDefault();
  });

  clearBtn.addEventListener("click", clearFiles);
  convertBtn.addEventListener("click", convertAll);
  downloadAllBtn.addEventListener("click", downloadAllZip);
  downloadCombinedBtn.addEventListener("click", downloadCombined);

  pageMarkerSelect.addEventListener("change", () => {
    const custom = pageMarkerSelect.value === "__custom";
    customMarkerWrap.hidden = !custom;
    if (custom) customMarkerInput.focus();
  });

  // Modal kata sandi
  pwForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const value = pwInput.value;
    if (!value) {
      pwError.hidden = false;
      pwError.textContent = "Kata sandi tidak boleh kosong.";
      pwInput.focus();
      return;
    }
    closePasswordModal(value);
  });
  pwCancel.addEventListener("click", () => closePasswordModal(null));
  passwordModal.addEventListener("click", (e) => {
    if (e.target.closest('[data-close="1"]')) closePasswordModal(null);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !passwordModal.hidden) closePasswordModal(null);
  });

  // Enter di input halaman langsung memulai konversi
  pageRangeInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      convertAll();
    }
  });

  // Tampilkan contoh format saat fokus pertama
  pageRangeInput.addEventListener("focus", () => {
    pageRangeInput.placeholder = "Contoh: 1-3, 5, 8-";
  });
  pageRangeInput.addEventListener("blur", () => {
    if (!pageRangeInput.value) pageRangeInput.placeholder = "Semua halaman (mis. 1-3, 5)";
  });

  // Tahun di footer tidak diperlukan; tautan repo mengikuti URL halaman
  const repoLink = $("footer-repo");
  if (repoLink) {
    const isGhPages = /\.github\.io$/i.test(location.hostname);
    const owner = "agusfm97";
    const repo = location.pathname.split("/").filter(Boolean)[0];
    if (isGhPages && repo) repoLink.href = `https://github.com/${owner}/${repo}`;
  }
})();
